'use strict';

const { Kafka, CompressionTypes, logLevel } = require('kafkajs');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const config = require('config');
const logger = require('screwdriver-logger');
const kafkaConfig = config.get('kafka');

/**
 * Gets the secret value from SecretsManager
 * @param {Object} _config the config object
 * @returns secret object
 */
const getSecretsValue = async _config => {
    try {
        const clientConfig = {
            region: _config.region,
            credentials: {
                accessKeyId: _config.accessKeyId,
                secretAccessKey: _config.secretAccessKey
            }
        };

        if (_config.sessionToken) {
            clientConfig.sessionToken = _config.sessionToken;
        }

        const client = new SecretsManagerClient(clientConfig);
        const command = new GetSecretValueCommand({ SecretId: _config.sasl.secretId });
        const data = await client.send(command);

        if ('SecretString' in data) {
            return data.SecretString;
        }

        const buff = Buffer.from(data.SecretBinary, 'binary').toString('base64');

        return buff.toString('ascii');
    } catch (err) {
        logger.error('Error in getting secrets', err);
        throw err;
    }
};

/**
 * Returns an instance of the Kafka class
 * @returns The kafka object
 */
async function getKafkaObject() {
    const secretsStr = await getSecretsValue(kafkaConfig);

    const secrets = JSON.parse(secretsStr);
    const brokersList = kafkaConfig.hosts.split(',');

    const kafka = new Kafka({
        logLevel: logLevel.ERROR,
        brokers: brokersList,
        clientId: kafkaConfig.clientId,
        ssl: true,
        sasl: {
            mechanism: kafkaConfig.sasl.mechanism,
            username: secrets.username,
            password: secrets.password
        }
    });

    return kafka;
}

const errorTypes = ['unhandledRejection', 'uncaughtException'];
const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

const createMessage = msg => ({
    key: `key-${msg.buildConfig.buildId}`,
    value: JSON.stringify(msg)
});

/**
 * Connects to a Kafka client instance
 * @returns Producer promise object
 */
const connect = async () => {
    if (!kafkaConfig.enabled) {
        return null;
    }

    const kafka = await getKafkaObject();

    try {
        const producer = kafka.producer();

        await producer.connect();

        const { DISCONNECT, CONNECT } = producer.events;

        producer.on(CONNECT, e => logger.info(`kafka Broker connected ${e.timestamp}: ${e}`));
        producer.on(DISCONNECT, e => logger.info(`kafka Broker disconnected ${e.timestamp}: ${e}`));

        errorTypes.map(type => {
            return process.on(type, async () => {
                try {
                    logger.error(`process.on ${type}`);
                    await producer.disconnect();
                    logger.info('kafka Broker disconnected');
                    process.exit(0);
                } catch (_) {
                    process.exit(1);
                }
            });
        });

        signalTraps.map(type => {
            return process.once(type, async () => {
                try {
                    await producer.disconnect();
                    logger.info('kafka Broker disconnected');
                } finally {
                    process.kill(process.pid, type);
                }
            });
        });

        return producer;
    } catch (err) {
        logger.error('kafka broker connection failure', err);
        throw err;
    }
};

/**
 * sends a message to a kafka topic,
 * call the connect method to get producer obj
 * @param {Object} producer the producer object
 * @param {Object} data the data object
 * @param {String} topic the topic name
 */
const sendMessage = async (producer, data, topic) => {
    const { job, buildConfig } = data;
    // after the produce has connected, we start start sending messages

    try {
        logger.info(`publishing msg ${job}:${buildConfig.buildId} to kafka topic:${topic}`);
        await producer.connect();
        await producer.send({
            topic,
            compression: CompressionTypes.GZIP,
            acks: 1,
            messages: [createMessage(data)]
        });
        logger.info(`successfully published msg id ${job}:${buildConfig.buildId} -> topic ${topic}`);
    } catch (e) {
        logger.error(
            `Publishing message ${buildConfig.buildId} to topic ${topic} failed ${e.message}: stack: ${e.stack}`
        );
    }
};

/**
 * Connects to a Kafka client instance as admin
 * @returns Admin promise object
 */
const connectAdmin = async () => {
    const kafka = await getKafkaObject();

    const admin = kafka.admin();

    await admin.connect();

    const { DISCONNECT, CONNECT } = admin.events;

    admin.on(CONNECT, e => logger.info(`kafka Admin connected ${e.timestamp}: ${e}`));
    admin.on(DISCONNECT, e => logger.info(`kafka Admin disconnected ${e.timestamp}: ${e}`));

    errorTypes.map(type => {
        return process.on(type, async () => {
            try {
                logger.error(`process.on ${type}`);
                await admin.disconnect();
                logger.info('kafka Broker Admin disconnected');
                process.exit(0);
            } catch (_) {
                process.exit(1);
            }
        });
    });

    signalTraps.map(type => {
        return process.once(type, async () => {
            try {
                await admin.disconnect();
                logger.info('kafka Broker Admin disconnected');
            } finally {
                process.kill(process.pid, type);
            }
        });
    });

    return admin;
};

/**
 * gets kafka topic metadata
 * @param {Object} admin The admin object after calling connectAdmin
 * @param {*} topic      The name of the topic
 * @returns topic metadata
 */
const getTopicMetadata = async (admin, topic) => {
    const metadata = await admin.fetchTopicMetadata({ topics: [topic] });

    await admin.disconnect();

    return metadata;
};

/**
 * creates a kafka topic in the cluster
 * @param {Object} admin The admin object after calling connectAdmin
 * @param {String} topic The name of the topic to be created
 */
const createTopic = async (admin, topic) => {
    const topics = await admin.listTopics();

    try {
        if (!topics.includes(topic)) {
            await admin.createTopics({ topics: [{ topic }] });
        }
    } catch (e) {
        logger.error(`Error creating ${topic} ${e.message}: stack: ${e.stack}`);
    }

    await admin.disconnect();
};

module.exports = {
    connect,
    connectAdmin,
    sendMessage,
    createTopic,
    getTopicMetadata
};

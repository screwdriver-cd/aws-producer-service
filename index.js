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

const errorTypes = ['unhandledRejection', 'uncaughtException'];
const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

const createMessage = msg => ({
    key: `key-${msg.buildConfig.buildId}`,
    value: JSON.stringify(msg)
});

let producer;
/**
 * Connects to a Kafka client instance
 * @param {Boolean} connectAdmin Flag to connect as admin
 * @param {Object} config The config object
 * @returns Producer promise object
 */
const connect = async (connectAdmin, producerConfig) => {
    // use config from parameters if available
    const _config = producerConfig || kafkaConfig;

    if (!_config.enabled) {
        return null;
    }
    if (producer) {
        return producer;
    }

    const secretsStr = await getSecretsValue(_config);

    const secrets = JSON.parse(secretsStr);
    const brokersList = _config.hosts.split(',');

    const kafka = new Kafka({
        logLevel: logLevel.ERROR,
        brokers: brokersList,
        clientId: _config.clientId,
        ssl: true,
        sasl: {
            mechanism: _config.sasl.mechanism, // scram-sha-256 or scram-sha-512 or plain
            username: secrets.username,
            password: secrets.password
        }
    });

    try {
        if (connectAdmin) {
            const admin = kafka.admin();

            await admin.connect();
            logger.info('kafka Broker connected with Admin privileges');

            return admin;
        }

        producer = kafka.producer();
        await producer.connect();
        logger.info('kafka Broker connected');

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
 * Connects to a Kafka client instance as admin
 * @returns Admin promise object
 */
const connectAdmin = async () => {
    const admin = connect(true);

    logger.info('kafka Broker Admin connected');

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
 * sends a message to a kafka topic
 * @param {Object} data the data object
 * @param {String} topic the topic name
 */
const sendMessage = async (data, topic) => {
    const { job, buildConfig } = data;
    // after the produce has connected, we start start sending messages

    try {
        logger.info(`publishing msg ${job}:${buildConfig.buildId} to kafka topic:${topic}`);
        await producer.send({
            topic,
            compression: CompressionTypes.GZIP,
            acks: 1,
            messages: [createMessage(data)]
        });
        logger.info(`successfully published msg id ${job}:${buildConfig.buildId} -> topic ${topic}`);
    } catch (e) {
        logger.error(`Publishing message ${buildConfig.buildId} to topic ${topic} failed ${e.message}`);
    }
};

/**
 * gets kafka topic metadata
 * @param {Object} admin The admin object after calling connect
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
 * @param {Object} admin The admin object after calling connect
 * @param {String} topic The name of the topic to be created
 */
const createTopic = async (admin, topic) => {
    const topics = await admin.listTopics();

    try {
        if (!topics.includes(topic)) {
            await admin.createTopics({ topics: [{ topic }] });
        }
    } catch (e) {
        logger.error(`Error creating ${topic} ${e.message}`);
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

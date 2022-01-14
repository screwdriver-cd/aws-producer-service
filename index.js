'use strict';

const { Kafka, CompressionTypes, logLevel } = require('kafkajs');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const config = require('config');
const logger = require('screwdriver-logger');
const kafkaConfig = config.get('kafka');
/**
 * Client type constant
 */
const CLIENT_TYPE = {
    ADMIN: 'admin',
    PRODUCER: 'producer'
};
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
// Error types constants
const errorTypes = ['unhandledRejection', 'uncaughtException'];
// Signal types constants
const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

/**
 *
 * @param {Object} msg the message object
 * @param {String} msgId The message id key
 * @returns
 */
const createMessage = (msg, msgId) => ({
    key: `key-${msgId}`,
    value: JSON.stringify(msg)
});

/**
 * Connects to a Kafka client instance
 * @param {String} clientType type of kafka instance admin|producer
 * @returns Producer/Admin promise object
 */
const createConnection = async clientType => {
    if (!kafkaConfig.enabled) {
        return null;
    }

    const kafka = await getKafkaObject();

    try {
        const client = clientType === CLIENT_TYPE.ADMIN ? kafka.admin() : kafka.producer();
        const { DISCONNECT, CONNECT } = client.events;

        client.on(CONNECT, e => logger.info(`kafka Broker ${clientType} connected ${e.timestamp}: ${e}`));
        client.on(DISCONNECT, e => logger.info(`kafka Broker ${clientType} disconnected ${e.timestamp}: ${e}`));

        errorTypes.forEach(type => {
            return process.on(type, async () => {
                try {
                    logger.error(`process.on ${type}`);
                    await client.disconnect();
                    logger.info(`kafka Broker ${clientType} disconnected`);
                    process.exit(0);
                } catch (_) {
                    process.exit(1);
                }
            });
        });

        signalTraps.forEach(type => {
            return process.once(type, async () => {
                try {
                    await client.disconnect();
                    logger.info(`kafka Broker ${clientType} disconnected`);
                } finally {
                    process.kill(process.pid, type);
                }
            });
        });

        await client.connect();

        return client;
    } catch (err) {
        logger.error('kafka broker connection failure', err);
        throw err;
    }
};

/**
 * Connects to a Kafka client instance as producer
 * @returns Producer promise object
 */
const connect = async () => {
    return createConnection(CLIENT_TYPE.PRODUCER);
};

/**
 * sends a message to a kafka topic,
 * call the connect method to get producer obj
 * @param {Object} producer the producer object
 * @param {Object} data the data object
 * @param {String} topic the topic name
 */
const sendMessage = async (producer, data, topic, messageId) => {
    // after the produce has connected, we start start sending messages
    try {
        logger.info(`publishing msg ${messageId} to kafka topic:${topic}`);
        await producer.connect();
        await producer.send({
            topic,
            compression: CompressionTypes.GZIP,
            acks: 1,
            messages: [createMessage(data, messageId)]
        });
        logger.info(`successfully published message ${messageId} -> topic ${topic}`);
    } catch (e) {
        logger.error(`publishing message ${messageId} to topic ${topic} failed ${e.message}: stack: ${e.stack}`);
    }
};

/**
 * Connects to a Kafka client instance as admin
 * @returns Admin promise object
 */
const connectAdmin = async () => {
    return createConnection(CLIENT_TYPE.ADMIN);
};

/**
 * gets kafka topic metadata
 * @param {Object} admin The admin object after calling connectAdmin
 * @param {*} topic      The name of the topic
 * @returns topic metadata
 */
const getTopicMetadata = async (admin, topic) => {
    let metadata;

    try {
        metadata = await admin.fetchTopicMetadata({ topics: [topic] });
    } catch (e) {
        logger.error(`Error fetching topic: ${topic} metadata ${e.message}: stack: ${e.stack}`);
    } finally {
        await admin.disconnect();
    }

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
    } finally {
        await admin.disconnect();
    }
};

module.exports = {
    connect,
    connectAdmin,
    sendMessage,
    createTopic,
    getTopicMetadata
};

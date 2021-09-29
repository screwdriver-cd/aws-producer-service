'use strict';

const { Kafka, CompressionTypes, logLevel } = require('kafkajs');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const config = require('config');
const logger = require('screwdriver-logger');
const kafkaConfig = config.get('kafka');

/**
 * Gets the secret value from SecretsManager
 * @param {Object} config the config object
 * @returns secret object
 */
const getSecretsValue = async (config) => {
    try {
        const clientConfig = {
            region: config.region,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey
            }
        }

        if (config.sessionToken) {
            clientConfig.sessionToken = config.sessionToken;
        }

        const client = new SecretsManagerClient(clientConfig);
        const command = new GetSecretValueCommand({ SecretId: config.sasl.secretId });
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

const createMessage = buildConfig => ({
    key: `key-${buildConfig.buildId}`,
    value: JSON.stringify(buildConfig)
});

let producer;
/**
 * Connects to a Kafka client instance
 * @returns Producer promise object
 */
const connect = async () => {
    if (!kafkaConfig.enabled) {
        return null;
    }
    if (producer) {
        return producer;
    }

    const secretsStr = await getSecretsValue(kafkaConfig);

    const secrets = JSON.parse(secretsStr);
    const brokersList = kafkaConfig.hosts.split(",");

    const kafka = new Kafka({
        logLevel: logLevel.ERROR,
        brokers: brokersList,
        clientId: kafkaConfig.clientId,
        ssl: true,
        sasl: {
            mechanism: kafkaConfig.sasl.mechanism, // scram-sha-256 or scram-sha-512 or plain
            username: secrets.username,
            password: secrets.password
        }
    });

    try {
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
        logger.error('kafka broker connection failiure', err);
        throw err;
    }
};

/**
 * sends a message to a kafka topic
 * @param {Object} data the data object
 * @param {String} topic the topic name
 */
const sendMessage = async (data, topic) => {
    // after the produce has connected, we start start sending messages
    try {
        const { job, buildConfig } = data;
        logger.info('publishing msg %s, to kafka topic: %s', job, buildConfig.buildId, topic);
        await producer.send({
            topic,
            compression: CompressionTypes.GZIP,
            acks: 1,
            messages: [createMessage(data)]
        });
        logger.info('successfully published msg id %s -> topic %s', job, buildConfig.buildId, topic);
    } catch (e) {
        logger.error(`Publishing message ${buildConfig.buildId} to topic ${topic} failed ${e.message}`);
    }
};

module.exports = {
    connect,
    sendMessage
};

'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });

describe('index', () => {
    let topicName;
    let kafkajsMock;
    let index;
    let configMock;
    let secretManagerMock;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        topicName = 'test-topic';
        /**
         * mock func
         */
        function kafkaInstanceMock() {
            return {
                producer: () => {
                    return { connect: sinon.stub(), send: sinon.stub() };
                },
                admin: () => {
                    return {
                        connect: sinon.stub().resolves(),
                        createTopics: sinon.stub().resolves(),
                        listTopics: sinon.stub().returns([]),
                        fetchTopicMetadata: sinon.stub().returns(),
                        disconnect: sinon.stub().resolves()
                    };
                }
            };
        }
        kafkajsMock = {
            Kafka: kafkaInstanceMock,
            CompressionTypes: {
                GZIP: 1
            },
            logLevel: {
                DEBUG: 5
            }
        };
        const conf = {
            enabled: true,
            hosts: 'b-3.abcd:9096,b-2.abcd:9096,b-1.abcd:9096',
            sasl: {
                mechanism: 'scram-sha-512',
                secretId: 'fakeSecret'
            },
            clientId: 'sd-producer',
            accessKeyId: 'testAccessKeyId',
            secretAccessKey: 'testSecretAccessKey',
            region: 'us-west-2'
        };

        class SecretsManagerClientMock {
            send() {
                return { SecretString: '{"username":"abc","password":123}' };
            }
        }
        /**
         * mock func
         */
        function GetSecretValueCommandMock() {}

        secretManagerMock = {
            SecretsManagerClient: SecretsManagerClientMock,
            GetSecretValueCommand: GetSecretValueCommandMock
        };

        configMock = {
            get: sinon.stub().returns(conf)
        };
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
        mockery.registerMock('kafkajs', kafkajsMock);
        mockery.registerMock('config', configMock);
        mockery.registerMock('@aws-sdk/client-secrets-manager', secretManagerMock);

        /* eslint-disable global-require */
        index = require('../index');
    });

    afterEach(async () => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    describe('connect', () => {
        it('connects to a kafka instance as a consumer', async () => {
            const producer = await index.connect();

            assert.isNotNull(producer);
            assert.calledOnce(producer.connect);
        });
    });
    describe('connect-use config from params', () => {
        it('connects to a kafka instance as a consumer', async () => {
            const producer = await index.connect(false, { enabled: false });

            assert.isNull(producer);
        });
    });
    describe('sendMessage', () => {
        it('sends a message to a kafka instance as a consumer', async () => {
            const producer = await index.connect();
            const msg = { buildConfig: { buildId: 123 }, job: 'start' };

            await index.sendMessage(msg, topicName);

            assert.calledOnce(producer.connect);
            assert.calledOnce(producer.send);
        });
    });
    describe('connectAdmin', () => {
        it('connects to a kafka instance as an admin', async () => {
            const admin = await index.connectAdmin();

            assert.isNotNull(admin);
            assert.calledOnce(admin.connect);
        });
    });
    describe('createTopic', () => {
        it('creates a topic in kafka instance as an admin', async () => {
            const admin = await index.connectAdmin();

            await index.createTopic(admin, topicName);

            assert.calledOnce(admin.connect);
            assert.calledOnce(admin.createTopics);
            assert.calledOnce(admin.disconnect);
        });
    });
    describe('getTopicMetadata', () => {
        it('gets a topic metadata from kafka instance as an admin', async () => {
            const admin = await index.connectAdmin();

            await index.getTopicMetadata(admin, topicName);

            assert.calledOnce(admin.connect);
            assert.calledOnce(admin.fetchTopicMetadata);
            assert.calledOnce(admin.disconnect);
        });
    });
});

# aws-producer-service
Screwdriver AWS Integration Producer Service
[![Version][npm-image]][npm-url] ![Downloads][downloads-image] [![Build Status][status-image]][status-url] [![Open Issues][issues-image]][issues-url] ![License][license-image]
> Producer Service for Screwdriver Kafka Queue

This service acts as a message producer to Screwdriver Kafka Queue.


## Table of Contents
- [Installation and Usage](#installation-and-usage)
- [Configuration](#configuration)
- [Methods](#methods)
- [Testing](#testing)
- [Contribute](#contribute)
- [License](#license)

### Installation and Usage

```bash
npm install screwdriver-aws-producer-service
```
## Configuration
The configuration for the package

| Parameter        | Type  | Default    | Description |
| :-------------   | :---- | :----------| :-----------|
|enabled| bool | true | Flag for enabling broker config|
|hosts| array | [] | Array of broker endpoints|
|sasl| object |  | sasl object|
|sasl.mechanism| string | scram-sha-512 | sasl mechanism|
|sasl.secretId| string | - | AWS secret manager id for sasl secret|
|clientId| string | - | Client id connecting to kafka brokers|
|accessKeyId| string | - | AWS access key id|
|secretAccessKey| string | - | AWS secret key id|
|region| string | - | AWS region|
```
kafka:
  # flag for kafka broker
  enabled: true
  # kafka brokers list
  hosts: KAFKA_BROKERS_LIST
  # sasl options
  sasl:
    # sasl mechanism
    mechanism: scram-sha-512
    # secret id for sasl/scram
    secretId: fakesecret
  # client id of the producer
  clientId: sd-producer
  # Amazon access key
  accessKeyId: KAFKA_ACCESS_KEY_ID
  # Amazon secret access key
  secretAccessKey: KAFKA_ACCESS_KEY_SECRET
  # AWS region 
  region: AWS_REGION
```

## Methods
#### `connect`
##### Expected Outcome
Connects as a client instance to ther kafka broker based on the specified configuration
##### Expected Return
A Promise that resolves to a kakfa producer object.

#### `sendMessage`
##### Expected Outcome
Sends a message to a kafka topic.
##### Required Parameters
| Parameter        | Type  |  Description |
| :-------------   | :---- | :-------------|
| data        | Object | The message data object |
| topic | String | The name of the topic |

## Testing

```bash
npm test
```

## Contribute
To start contributing to Screwdriver, have a look at our guidelines, as well as pointers on where to start making changes, in our [contributing guide](http://docs.screwdriver.cd/about/contributing).

## License

Code licensed under the BSD 3-Clause license. See LICENSE file for terms.

[npm-image]: https://img.shields.io/npm/v/screwdriver-aws-producer-service.svg
[npm-url]: https://npmjs.org/package/screwdriver-aws-producer-service
[downloads-image]: https://img.shields.io/npm/dt/aws-producer-service.svg
[license-image]: https://img.shields.io/npm/l/aws-producer-service.svg
[issues-image]: https://img.shields.io/github/issues/screwdriver-cd/screwdriver.svg
[issues-url]: https://github.com/screwdriver-cd/screwdriver/issues
[status-image]: https://cd.screwdriver.cd/pipelines/7971/badge
[status-url]: https://cd.screwdriver.cd/pipelines/7971
[screwdriver job-tools]: https://github.com/screwdriver-cd/job-tools

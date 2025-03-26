# How to run on GCP

Create a service account in [IAM & Admin > Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts), and a JSON Key. Download the key and use it in `GOOGLE_APPLICATION_CREDENTIALS`.

Create the necessary Pub/Sub topics and subscriptions, refer to Snowplow documentation if necessary.

Run from the opensnowcat/ directory. 

To run with DEBUG mode add:
`-e JAVA_TOOL_OPTIONS="-Dorg.slf4j.simpleLogger.defaultLogLevel=${LOGLEVEL:-DEBUG}"`


```
 docker run \
  -it --rm \
  -v $PWD:/opensnowcat \
  -e GOOGLE_APPLICATION_CREDENTIALS=/opensnowcat/deletethisnoproblem-df264b003492.json \
 opensnowcat/opensnowcat-enrich-pubsub:1.3.0-preview \
  --enrichments /opensnowcat/enrichments \
  --iglu-config /opensnowcat/resolver.json \
  --config /opensnowcat/gcp/config.enrich.hocon
```

```
docker run \
  -it --rm \
  -v $PWD:/opensnowcat \
  -e GOOGLE_APPLICATION_CREDENTIALS=/opensnowcat/deletethisnoproblem-df264b003492.json \
  -p 8080:8080 \
  opensnowcat/opensnowcat-collector-pubsub \
  --config /opensnowcat/gcp/config.collector.hocon
  ```
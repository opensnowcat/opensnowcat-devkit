# How to run on AWS Kinesis

`make run-kinesis` runs the collector and enrich locally, reading from and writing to Kinesis streams in your AWS account. The console runs too: it tails the enriched and bad streams straight from Kinesis and serves your local schemas to enrich.

## Setup

1. The pipeline needs four Kinesis streams: `collected-good`, `collected-bad`, `enriched-good`, `enriched-bad` (other names work too, see below). `make run-kinesis` does not create them; it stops if any is missing. Create them yourself, or run `make kinesis-create-streams` once credentials are set (step 2): it creates the missing ones in on-demand mode in `AWS_REGION` and prints the account first.
2. Give it credentials, either way:

   Access keys exported in your shell:

   ```
   export AWS_ACCESS_KEY_ID=AKIA...
   export AWS_SECRET_ACCESS_KEY=...
   export AWS_REGION=us-west-2
   ```

   Or a profile, in `.env` at the repository root (copy `.env.example`) or exported:

   ```
   AWS_PROFILE=dev
   AWS_REGION=us-west-2
   ```

   If the profile uses SSO, log in first: `aws sso login --profile dev`.
3. Check the streams are visible: `make kinesis-streams`.
4. Start: `make run-kinesis`. Stop with `make stop`.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | | Access keys; when both are set they are used and `AWS_PROFILE` is ignored |
| `AWS_SESSION_TOKEN` | | Only for temporary keys |
| `AWS_PROFILE` | `default` | Profile the credentials are exported from when no keys are exported |
| `AWS_REGION` | `AWS_DEFAULT_REGION`, profile region, then `us-east-1` | Region of the streams |
| `KINESIS_COLLECTOR_GOOD` | `collected-good` | Collector good stream, enrich input |
| `KINESIS_COLLECTOR_BAD` | `collected-bad` | Collector bad stream |
| `KINESIS_ENRICHED_GOOD` | `enriched-good` | Enrich good output |
| `KINESIS_ENRICHED_BAD` | `enriched-bad` | Enrich bad output |
| `KINESIS_ENRICH_APP_NAME` | `opensnowcat-enrich-devkit` | KCL app name and DynamoDB checkpoint table |

Set them in `.env` or inline: `AWS_PROFILE=dev AWS_REGION=eu-west-1 make run-kinesis`.

## Credentials

If `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are exported in your shell, `make run-kinesis` passes them (and `AWS_SESSION_TOKEN`, when set) straight to the containers. Otherwise it runs `aws configure export-credentials` for `AWS_PROFILE` and passes the result, so SSO, assume-role and static keys in `~/.aws` all work the same way. The first line of output says which source was used. Temporary credentials are not refreshed inside the containers: when they expire, run `make run-kinesis` again.

The identity needs:

- Kinesis: `DescribeStream*`, `ListShards`, `PutRecord(s)` on the collector and enrich output streams, `GetRecords`, `GetShardIterator`, `SubscribeToShard` on the enrich input stream.
- Console: `DescribeStreamSummary`, `ListShards`, `GetShardIterator`, `GetRecords` on the four streams.
- DynamoDB: create and read/write the checkpoint table named after `KINESIS_ENRICH_APP_NAME`. Enrich creates it on first start. Delete it to reprocess from the start.

Enrich starts from `LATEST` and has CloudWatch metrics turned off; both are set in `config.enrich.hocon`.

## Console

The console reads `enriched-good`, `enriched-bad` and `collected-bad` with plain `GetRecords` polling, one loop per shard, starting at the newest record. It has no lease table and no Enhanced Fan-Out: it is just another reader next to enrich and takes nothing away from it. Idle shards are polled once a second, well inside the 5 reads per second Kinesis allows per shard.

Because it reads the streams directly, it also works when the collector and enrich run somewhere else. Point it at the streams and region and it tails them. Anyone else sending to the same streams shows up too; filter by app id.

- **Live stream**: the same good and bad timeline as with Kafka.
- **Pipeline**: the four streams with status, shards, mode, retention and how far behind the console's reader is. Kafka topics and consumer groups are not shown.
- **Ready**: enrich counts as up while its container runs, and the pipeline is ready once a probe event sent through the collector comes back enriched.

Running the console on its own against Kinesis:

```
NUXT_STREAM_SOURCE=kinesis AWS_REGION=us-west-2 \
NUXT_TOPIC_ENRICHED_GOOD=enriched-good NUXT_TOPIC_ENRICHED_BAD=enriched-bad NUXT_TOPIC_COLLECTED_BAD=collected-bad \
  make dev-console
```

It picks up credentials from the environment like any AWS SDK client.

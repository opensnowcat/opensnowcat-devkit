# OpenSnowcat Devkit

This devkit was forked from Gitlab, the purpose is to provide an easy local development 
environment for OpenSnowcat. 

There are two options to use this devkit: Kafka or Warpstream (Kafka compatible platform). 

Note if you run warpstream it is limited to 4 hours (warpstream demo) but Kafka is not.

Run docker from root directory for Windows/Mac/Linux compatibility.

`run make-help` to see all options.

Add the line to your /etc/hosts: `127.0.0.1  warp`

Both when running Kafka and Warpstream Kafka UI is available at http://localhost:8081.

## Using Kafka

Start the environment with: `make run-kafka`

## Using Warpstream

Start the environment with: `make run-warpstream` and `make warpstream-console` to get the console URL.

## Sending events to the collector

Run `make send-good` to send 10 events to the collector, or `make send-bad` to send 10 bad events. 

## Bento with OpenSnowcat processor

[Bento](https://warpstreamlabs.github.io/bento/) is a lightweight event processing engine for building real-time data pipelines. It is used to route events, applying transformations and filters along the way.

The [Bento opensnowcat processor](https://warpstreamlabs.github.io/bento/docs/components/processors/opensnowcat) allows you to process, filter and enrich TSV events from any sink. In this devkit we load Bento opensnowcat processor that converts TSV events to JSON. See `/bento` yml files for more details or visit Bento website.

## Using Google Cloud

See README.md under opensnowcat/gcp/.


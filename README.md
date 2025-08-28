# OpenSnowcat Devkit

This devkit was forked from Gitlab, the purpose is to provide an easy local development 
environment for OpenSnowcat. 

There are two options to use this devkit: Kafka or Warpstream (Kafka compatible platform). 

Note if you run warpstream it is limited to 4 hours (warpstream demo) but Kafka is not.

Run docker from root directory for Windows/Mac/Linux compatibility.

## Using Kafka

Add the line to your /etc/hosts

`127.0.0.1  warp`

Start the environment with: `docker compose up`

Open your browser and visit KafkaUI: `http://localhost:8081` to inspect your kafka topics and messages. Topics are created automatically according to the collector and enricher configuration.

## Using Warpstream

Start the environment with: `docker compose -f docker-warpstream.yml up`  

## Using Google Cloud

See README.md under opensnowcat/gcp/.

## Sending events to the collector

The easiest way to send events to the collector is using ngrok to map your local collector to a public https endpoint and then use [Snowplow Chrome Debugger](https://chromewebstore.google.com/detail/snowplow-debugger/jbnlcgeengmijcghameodeaenefieedm)  [collector override ](https://www.snowcatcloud.com/docs/snowplow-chrome-extension/how-to-use/#collector-override/) feature. 

Open a terminal and run ngrok.

`ngrok http 8080`

Use the ngrok URL `https://xxxxxxxx.ngrok-free.app` in the SnowcatCloud Chrome Extension in the collector override.

## Send Events

Send 100 bad events 10 at a time.
`./send_bad_events.sh 100 https://aa27003dcf40.ngrok-free.app 10`

Send 100 good events 10 at a time.
`./send_good_events.sh 100 https://aa27003dcf40.ngrok-free.app 10`

 
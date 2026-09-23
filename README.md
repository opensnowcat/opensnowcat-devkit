# OpenSnowcat Devkit

A local development environment for [OpenSnowcat](https://opensnowcat.io): collector, enrich, Kafka (or WarpStream), Bento, and the **OpenSnowcat Console**, a web UI where you watch good and bad events stream live, edit schemas in place, control the pipeline, expose the collector over HTTPS, and send test events.

Run everything from the repository root for Windows/Mac/Linux compatibility.

Run `make help` to see all options.

Add this line to your `/etc/hosts`: `127.0.0.1  warp`

## Quick start

```
make run
```

This starts the pipeline on Apache Kafka, waits for the console to come up, and opens it at http://localhost:8082. The collector listens on http://localhost:8080. `make run-kafka` is the same thing, and `make run-warpstream` uses WarpStream instead.

WarpStream is Kafka-compatible and its demo is limited to 4 hours; `make warpstream-console` prints its cloud console URL.

## OpenSnowcat Console

The console runs as a container next to the pipeline and talks to Kafka directly.

| Page | What you do there |
|---|---|
| **Live stream** | One timeline of good and bad events, tailed from Kafka as enrich writes them. Filter by good/bad, app id, event, schema, or bad row type. Click an event for entities, atomic fields, failure details, and the raw payload. Send test events from the toolbar. |
| **Schemas** | Browse every folder registry, edit schemas in place with igluctl-style validation, create new ones, bump versions, test sample data. Saves are live: enrich resolves the new file on the next event. |
| **Schema registries** | The Iglu resolver as a form: folders served by the console, the SnowcatCloud Schema Registry (paste an API key, click Check key to confirm it is authorized and pulls schemas), HTTP registries such as Iglu Central or your own Iglu Server, and embedded ones, with priorities, vendor prefixes, and cache. Saving restarts enrich for you. A resolve tester shows which registry answers for any Iglu URI. |
| **Expose** | Start a Cloudflare quick tunnel with one click to get an HTTPS URL for the collector, with a QR code for phones, or follow the instructions to run cloudflared yourself. Copy a tracker snippet pointed at the active URL. |
| **Pipeline** | Container status, restart enrich/collector/Bento, tail logs, topic offsets, and consumer groups. |

### How schemas are served

Your schema directory is mounted into the console, which serves it to enrich as a static Iglu registry at `http://console:3000/iglu`. The devkit ships with the resolver cache at zero, so every edit is picked up immediately, no restart, no cache flush. Registry and enrichment config changes still need an enrich restart, and the console does that when you save on the Linking page.

The default directory is [`schemas/`](schemas/) in this repository, laid out the Iglu way: `<vendor>/<name>/jsonschema/<model>-<revision>-<addition>`. Point it at your own directory by copying `.env.example` to `.env` and setting `SCHEMAS_DIR`. Any other folder under your home directory can be added as a registry from the Schema registries page: Add registry, Another folder, Browse, pick it. The console container mounts your home directory for this; set `HOST_HOME` in `.env` to expose a narrower parent instead.

### Console image

The console is published as `opensnowcat/opensnowcat-console` on Docker Hub, built from [`console/`](console/) by GitHub Actions. Compose builds it locally the first time if the image is not present, so the devkit works without Docker Hub too. After changing the source, rebuild with:

```
make build-console
```

To fetch the published image instead of building: `docker compose pull console`.

To hack on the console with hot reload against a running devkit (needs Node 22):

```
make dev-console
```

The console listens on port 8082 inside the devkit, so it stays clear of the collector on 8080, Kafka UI on 8081, and whatever you run on 3000. The console container needs the Docker socket mounted to restart containers and start the tunnel. Everything else works without it.

## Sending events to the collector

Use the **Send events** button in the console, or from a terminal: `make send-good` sends 10 events, `make send-bad` sends 10 bad ones.

## Kafka UI

The Provectus Kafka UI is still available for topic-level work, behind an optional profile: `make kafka-ui` starts it on http://localhost:8081.

## Bento with OpenSnowcat processor

[Bento](https://warpstreamlabs.github.io/bento/) is a lightweight event processing engine for building real-time data pipelines. It is used to route events, applying transformations and filters along the way.

The [Bento opensnowcat processor](https://warpstreamlabs.github.io/bento/docs/components/processors/opensnowcat) allows you to process, filter and enrich TSV events from any sink. In this devkit we load Bento opensnowcat processor that converts TSV events to JSON. See `/bento` yml files for more details or visit Bento website.

## Using Google Cloud

See README.md under opensnowcat/gcp/.

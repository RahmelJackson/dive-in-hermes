# Dive In for Hermes Agent

Dive In turns a public source into a visual investigation. Follow the original
exchange, compare claims against measured data, inspect the source trail, and
explore the whole story in Big picture. Signal Atlas is the SQLite evidence
ledger and agent toolset underneath the workspace.

## Install in Hermes Desktop

1. Install the repository with `hermes plugins install https://github.com/RahmelJackson/dive-in-hermes`
   or use **Install from Git** in **Capabilities → Plugins** and select both
   the agent and Desktop components.
2. Enable the agent plugin for your profile with
   `hermes plugins enable signal-atlas`. Enable **Dive In** under Desktop
   plugins, then restart the gateway so it mounts the plugin's API.
3. Open **Dive In** from the sidebar. **Try the GPU story** opens a saved,
   reproducible investigation without a model call. For a new investigation,
   paste a public URL or provide an excerpt or transcript.

Research and follow-up buttons submit a new Hermes chat turn using the active
profile's model and enabled tools. **Open research chat** opens its transcript
for progress, approvals, and questions. The chat saves findings through
`signal_atlas_studio_action`, and Dive In reads the same profile's evidence
ledger. If a source is unavailable, attach an excerpt or transcript.

The visual workspace is served through Hermes's profile-scoped plugin API
and mounted in the Desktop SDK's sandboxed frame. The responsive browser
preview below uses the same interface and ledger operations.

## Data and network behavior

- Captures, notes, saved stories, and follow-ups are kept in the active Hermes
  profile's `plugin-data/signal-atlas/` directory. No telemetry is sent.
- The plugin reads its bundled fixtures and assets. It makes HTTPS requests
  for feeds only when a URL is supplied to the ingestion tool. A research
  request uses the active Hermes model and any approved web tools. Source
  links open in the default browser when clicked.
- The plugin does not launch a separate service inside Hermes or store
  credentials. The optional browser preview listens on loopback while its
  command is running. Geist fonts are distributed under the bundled SIL OFL.

## Signal Atlas tools

| Capability | Output |
| --- | --- |
| Signal Hunter | Distinct article volume in two consecutive seven-day windows, with citations |
| Narrative Explorer | Dated timeline, undated items, reported-claim candidates and same-URL relationships |
| Conversation Atlas | Feed excerpt questions and argument candidates with evidence IDs and links |
| Context Lens | Feed inventory, last successful pulls, source-host counts, date quality and evidence lookup |
| Creator Opportunity Engine | Cited editorial angles, background and reporting tasks |

## Preview the Studio in a browser

Clone the repository as `signal-atlas` and run the preview from its parent
directory:

```text
git clone https://github.com/RahmelJackson/dive-in-hermes signal-atlas
python -B -m signal-atlas.studio --db studio-demo.sqlite3 --open
```

Open the printed localhost URL if the browser does not open. Select **Try the
GPU story** to explore the captured investigation without a model. Use a
separate database for real source captures. Press Ctrl+C to stop the preview.
[Demo walkthrough](DEMO.md)

## Start with a social link

Paste a link in Dive In to start a Hermes research chat. To capture an excerpt
or transcript directly through the CLI, save it as UTF-8 and run from the
parent directory:

```text
python -B -m signal-atlas --db live.sqlite3 capture "your topic" "https://example.org/post" excerpt.txt
python -B -m signal-atlas --db live.sqlite3 conversation "your topic"
```

The link is stored as a citation. Capture reads the local text file and labels
the source as user-supplied. Use `--date` with an explicit timezone to include
the capture in the dated signal windows. Social retrieval depends on the active
Hermes profile's approved tools and what the platform makes publicly available.

## Run the offline demo

Run from the directory **containing** the `signal-atlas` folder. Use a new demo
database to keep synthetic data separate from your live research.

```text
python -B -m signal-atlas --db demo.sqlite3 demo
python -B -m signal-atlas --db demo.sqlite3 evidence <id-from-demo>
python -B -m unittest discover -s signal-atlas/tests -v
```

The demo runs all five views. Expect six feed observations across five canonical
URLs, three recent articles versus one in the previous window, one shared URL
and one timezone-less date. The URLs and reporting are fictional.

For live data, run `python -B -m signal-atlas --db live.sqlite3 ingest "your topic" "https://publisher.example/feed.xml"`
with a real publisher's public feed URL. Repeat the command to refresh and
replace `ingest` with `signals`, `narrative`, `conversation`, `context` or
`brief` to query the topic without the URL argument.

## Use in Hermes Desktop or CLI

1. Copy this folder into the active Hermes profile's user plugin directory,
   normally `~/.hermes/plugins/signal-atlas`. Enable it with
   `hermes plugins enable signal-atlas`.
2. Restart the Hermes gateway if it is already running. In Desktop, check
   **Capabilities → Plugins** and open a chat on the same gateway/profile.
3. Ask: “Load the Signal Atlas synthetic demo. Use the returned reference time
   to run Signal Hunter, then show the narrative, public questions, coverage
   gaps and a cited editorial brief for cool roofs.”
4. For a real topic, provide its label and the public RSS or Atom URLs to ingest.
   Ask Hermes to load the bundled `signal-atlas:research` skill when synthesizing
   a brief with the configured chat model.

The Desktop integration uses its supported shared agent gateway and chat tools.
Hermes stores the SQLite ledger under the active profile's
`plugin-data/signal-atlas/` directory. The CLI demo is standalone and takes an
explicit database path. Official interfaces checked November 11, 2026.
[Hermes developer guide](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins) ·
[Hermes plugin and gateway guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)

## Evidence and scope

- The topic is an onboarding label. Each accepted entry from its feed is assigned
  that label. Choose topic-specific feeds for meaningful volume comparisons.
- Article identity is the HTTP(S) URL after fragment and known tracking parameter
  removal. Each feed observation has a stable hash of its normalized record.
  Repeats update observation bounds and changed records retain earlier IDs.
  Volume counts distinct URLs, so cross-domain mirrors may still count separately.
- Raw date text, source field, normalized UTC and parse status remain separate
  from first and last observation times. The signal windows use normalized feed
  dates only and may use Atom's update time when publication time is absent.
  The reference time anchors volume windows over the current ledger.
- Retrieval accepts direct, uncompressed UTF-8 HTTPS RSS 2.0 or Atom endpoints
  supplied by the user. It caps responses at 2 MB and processing at 250 entries
  per feed. It rejects redirects and private addresses. It reads feed metadata
  and excerpts only. Prefer public URLs without access tokens.
- Question and argument detection uses punctuation and keywords. Claim candidates
  are attributed feed text. Shared URLs indicate overlap and do not establish
  independent corroboration. The chat model can synthesize and compare views
  using cited evidence, while the offline path runs without a model.

Scheduled refresh and direct social-platform API connectors are future work.
The offline demo, evidence operations, and registration contract are covered
by tests.


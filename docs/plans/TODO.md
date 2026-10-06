# TODO

- check how looks debugging of script required in script (.ts)
- multiple sessions for same plugin (needs rework UI, some buttons apply only for bundle)
- add new host apps support
- feature to attach plugins without loading them via Debugger?
- investigate Media Encoder launch hanging when the broker is already running
- move json config creation under triple dot
- decide script targeting, should it follow file extension? Does target apply only to generic extension?
- allow to fetch plugin/script entries from launch.json config? It contains all necessary data. Or would it be temporary only while workspace is opened?

## DONE

- debugging gated by catalog minVersion (launch anything, debug only supported versions)
- debug auto-loads the plugin and respects the break on load checkbox
- test MacOS
- find out why I don't see error in console log
- review commands
- copyright
- fix break on load
- improve Inspector UI
- builder hooks
- MCP
- change stop/start icons
- improve UI for takeover
- add on/off button to be able switch to UDT
- highlight active directory
- compact mode
- simply just offer list of parents instead?
- packer
- don't offer script run if there is no relevant host app
- no need for local settings.json?
- offer manifest file open
- XD run
- watcher
- map fixer
- running without activating project

## POSTPONED

- reusability
- for scripts figure out detach vs stop. Sometimes we want run till end. Something quit now.

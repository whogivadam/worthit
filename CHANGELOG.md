# Changelog

## [0.4.1](https://github.com/whogivadam/worthit/compare/v0.4.0...v0.4.1) (2026-10-29)


### Bug Fixes

* **overlay:** skip screen-reader-only text when badging ([#65](https://github.com/whogivadam/worthit/issues/65)) ([6ee226c](https://github.com/whogivadam/worthit/commit/6ee226c2c9d64ce39294bce22ec273f2c01dfa9b))
* **parser:** accept the Swedish '.-' price suffix ([#64](https://github.com/whogivadam/worthit/issues/64)) ([a8e9604](https://github.com/whogivadam/worthit/commit/a8e960436573df9b6e218ed89de050e90cc13ccd))
* **parser:** stop reading a currency token glued inside a number run ([#67](https://github.com/whogivadam/worthit/issues/67)) ([cd1f8cd](https://github.com/whogivadam/worthit/commit/cd1f8cdd7c15d003f41da94ef05f78628f1e18e0))


### Documentation

* **repo:** keep the privacy policy browser-neutral ([#60](https://github.com/whogivadam/worthit/issues/60)) ([588a9b8](https://github.com/whogivadam/worthit/commit/588a9b8e1e5e2a3f793467f41c745d02a2f275bb))

## [0.4.0](https://github.com/whogivadam/worthit/compare/v0.3.1...v0.4.0) (2026-10-27)


### Features

* **manifest:** run in Chrome and publish to the Chrome Web Store ([#56](https://github.com/whogivadam/worthit/issues/56)) ([ad79db7](https://github.com/whogivadam/worthit/commit/ad79db79bbc5e380ddbeb9a979bb7909892b2a3c))


### Documentation

* **release:** answer the broad-host-permission warning head-on ([#57](https://github.com/whogivadam/worthit/issues/57)) ([2cb7b93](https://github.com/whogivadam/worthit/commit/2cb7b93b96209874da81868c28112003cf206c02))
* **release:** make the store-review text say what a reviewer can check ([#58](https://github.com/whogivadam/worthit/issues/58)) ([161169e](https://github.com/whogivadam/worthit/commit/161169e33295e4ed9abc0e187d56878763537544))
* **release:** record how AMO handles listing metadata ([#52](https://github.com/whogivadam/worthit/issues/52)) ([d750cae](https://github.com/whogivadam/worthit/commit/d750cae6bcb0b199d47a77d6c8f1679af3d2026b))

## [0.3.1](https://github.com/whogivadam/worthit/compare/v0.3.0...v0.3.1) (2026-10-26)


### Bug Fixes

* **parser:** stop reading clock times as Swedish prices ([#51](https://github.com/whogivadam/worthit/issues/51)) ([543e6a3](https://github.com/whogivadam/worthit/commit/543e6a35a2e0248d6ca8940c42bdb84d07b64d63))


### Documentation

* **release:** translate the AMO listing into Swedish ([#48](https://github.com/whogivadam/worthit/issues/48)) ([5a54c69](https://github.com/whogivadam/worthit/commit/5a54c69f5cdb2c34c054fb8a3690a76273118826))

## [0.3.0](https://github.com/whogivadam/worthit/compare/v0.2.0...v0.3.0) (2026-10-25)


### Features

* **popup:** add a language setting and a Swedish translation ([#43](https://github.com/whogivadam/worthit/issues/43)) ([59f262b](https://github.com/whogivadam/worthit/commit/59f262b722ad4ba50f31cf382522fde77d68328e))
* **popup:** make the currency picker searchable by code or country ([#46](https://github.com/whogivadam/worthit/issues/46)) ([c17d644](https://github.com/whogivadam/worthit/commit/c17d644a728f23a60cdb7d605ba632e347a6b39e))


### Documentation

* **repo:** drop the pre-launch note from the install section ([#41](https://github.com/whogivadam/worthit/issues/41)) ([8c50112](https://github.com/whogivadam/worthit/commit/8c50112c80762c363fd2ee8e9079e77e09fa6465))

## [0.2.0](https://github.com/whogivadam/worthit/compare/v0.1.0...v0.2.0) (2026-10-25)


### Features

* **popup:** show a country flag beside every currency ([#40](https://github.com/whogivadam/worthit/issues/40)) ([1d63e63](https://github.com/whogivadam/worthit/commit/1d63e637daed7f581c2cfd6214499b69238d3d68))


### Bug Fixes

* **ci:** allow re-submitting a version to AMO ([#36](https://github.com/whogivadam/worthit/issues/36)) ([242e564](https://github.com/whogivadam/worthit/commit/242e56439106e33d0d4122d8dee76ccdb74cd356))

## 0.1.0 (2026-10-21)


### Features

* **calc:** add income and worktime conversion ([#28](https://github.com/whogivadam/worthit/issues/28)) ([da29101](https://github.com/whogivadam/worthit/commit/da291019adc7570ecadcc2c46bf88a2ed10d6dd8))
* **overlay:** add inline price badges with mutation observer ([#31](https://github.com/whogivadam/worthit/issues/31)) ([3cce2ab](https://github.com/whogivadam/worthit/commit/3cce2ab41fd94667c65a6a694745283b74b225ae))
* **parser:** add the currency table and price parser ([#26](https://github.com/whogivadam/worthit/issues/26)) ([270683c](https://github.com/whogivadam/worthit/commit/270683cef376fbc8b298fde1fc16e5d6da7dcb90))
* **popup:** add settings, manual check, history and share ([#30](https://github.com/whogivadam/worthit/issues/30)) ([a738320](https://github.com/whogivadam/worthit/commit/a738320686ebbe8bb7537f8782476cfbfa23f8a3))
* **rates:** add rate fetch, cache, fallbacks and background ([#29](https://github.com/whogivadam/worthit/issues/29)) ([4d8823b](https://github.com/whogivadam/worthit/commit/4d8823b0ccd3fb937c993e910cb29484c8156ff2))


### Bug Fixes

* **ci:** make the test script portable and update workflow pins ([#7](https://github.com/whogivadam/worthit/issues/7)) ([c4cf9b7](https://github.com/whogivadam/worthit/commit/c4cf9b7fd274558945876b95119aa9a560910835))


### Documentation

* **release:** add AMO metadata, icons and capture harness ([#32](https://github.com/whogivadam/worthit/issues/32)) ([92ec487](https://github.com/whogivadam/worthit/commit/92ec487b7dd89e0ca28dbe41530398cc8913142f))
* **release:** add the captured AMO screenshots ([#34](https://github.com/whogivadam/worthit/issues/34)) ([c99a875](https://github.com/whogivadam/worthit/commit/c99a875f7507401ea21e3f6dda9e82348c90950b))

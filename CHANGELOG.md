# Changelog

## [0.6.1](https://github.com/mashiro/otelop/compare/v0.6.0...v0.6.1) (2026-04-28)


### Bug Fixes

* **deps:** update all non-major dependencies ([#61](https://github.com/mashiro/otelop/issues/61)) ([1da3a81](https://github.com/mashiro/otelop/commit/1da3a81a6b54b631ea8db563ebcd0b693055e651))
* **deps:** update all non-major dependencies ([#65](https://github.com/mashiro/otelop/issues/65)) ([a7265d3](https://github.com/mashiro/otelop/commit/a7265d3692a3cc5ce9486a1cd6b102edc58b6048))

## [0.6.0](https://github.com/mashiro/otelop/compare/v0.5.1...v0.6.0) (2026-04-18)


### Features

* **server:** emit spa.stat and spa.serve spans ([#59](https://github.com/mashiro/otelop/issues/59)) ([fe46f65](https://github.com/mashiro/otelop/commit/fe46f65c18c2dae450e5dd1d0770677dcf70812f))
* **store:** emit ingest spans with batch counts ([#60](https://github.com/mashiro/otelop/issues/60)) ([91c575b](https://github.com/mashiro/otelop/commit/91c575b45ab3eb6d05a7c98707ff7236d9e6aead))


### Bug Fixes

* **cli:** show wall-clock uptime across system sleep ([#57](https://github.com/mashiro/otelop/issues/57)) ([414ab04](https://github.com/mashiro/otelop/commit/414ab04a07165550fc620a91903787ceb73695ba))
* **deps:** update all non-major dependencies ([#54](https://github.com/mashiro/otelop/issues/54)) ([5b51eeb](https://github.com/mashiro/otelop/commit/5b51eebf5e73853a91c2ed5ab50e543104f0cd3f))
* **deps:** update all non-major dependencies to v0.150.0 ([#55](https://github.com/mashiro/otelop/issues/55)) ([16ffc66](https://github.com/mashiro/otelop/commit/16ffc66722c297cc65c8b7561b0e81446f5c1246))


### Performance Improvements

* **frontend:** stable key for DataPointsTable rows ([#53](https://github.com/mashiro/otelop/issues/53)) ([566ac53](https://github.com/mashiro/otelop/commit/566ac53e00c2d28a8f119284c49138cbd2387500))
* **store:** cache HasError and add parent/log lookup indexes ([#47](https://github.com/mashiro/otelop/issues/47)) ([cfa5a85](https://github.com/mashiro/otelop/commit/cfa5a85ff54c2cd3bffcb78767cebd1865ab0575))
* **store:** hash series keys with maphash instead of allocating strings ([#52](https://github.com/mashiro/otelop/issues/52)) ([85cad94](https://github.com/mashiro/otelop/commit/85cad943ab5bdaa0c57a060877c8997a8b409dae))

## [0.5.1](https://github.com/mashiro/otelop/compare/v0.5.0...v0.5.1) (2026-04-14)


### Bug Fixes

* **store:** derive trace duration from full span range ([#40](https://github.com/mashiro/otelop/issues/40)) ([e44d54d](https://github.com/mashiro/otelop/commit/e44d54d9278182a3d0d68b8f76f233cccee09cc7))

## [0.5.0](https://github.com/mashiro/otelop/compare/v0.4.0...v0.5.0) (2026-04-13)


### Features

* **proxy:** add OTLP proxy forwarding ([#34](https://github.com/mashiro/otelop/issues/34)) ([8dc025f](https://github.com/mashiro/otelop/commit/8dc025fc8fc21602d9d2e17db216a0e664dec65c))
* **server:** enable WebSocket per-message compression ([#38](https://github.com/mashiro/otelop/issues/38)) ([ec6605e](https://github.com/mashiro/otelop/commit/ec6605ed8a4ae2696d6c7f4cbd4ca9b05c9c9097))


### Bug Fixes

* **collector:** normalize confmap values for static provider ([#36](https://github.com/mashiro/otelop/issues/36)) ([ace8394](https://github.com/mashiro/otelop/commit/ace8394ba7853a1c8f3c12f9a893b792370e861d))
* **store:** skip empty metrics to avoid null dataPoints over WebSocket ([#37](https://github.com/mashiro/otelop/issues/37)) ([4d2ba94](https://github.com/mashiro/otelop/commit/4d2ba94a83e75f91f83d60c2457b64440e68364b))

## [0.4.0](https://github.com/mashiro/otelop/compare/v0.3.0...v0.4.0) (2026-04-13)


### Features

* **cli:** add background daemon mode with start/stop/status ([#27](https://github.com/mashiro/otelop/issues/27)) ([245fdc1](https://github.com/mashiro/otelop/commit/245fdc1ea17975e2668049e7fab9522faea12b22))
* **cli:** add logs/restart commands and tighten config validation ([#29](https://github.com/mashiro/otelop/issues/29)) ([db06a88](https://github.com/mashiro/otelop/commit/db06a88f6eaaa3e629e8366d1e1475cb6800ab98))
* **cli:** load start defaults from TOML config and env vars ([#28](https://github.com/mashiro/otelop/issues/28)) ([cc15f73](https://github.com/mashiro/otelop/commit/cc15f733c1513f6c6eb7ddf4fd57e10d1b3d11be))


### Bug Fixes

* **deps:** update all non-major dependencies to v19.2.5 ([#23](https://github.com/mashiro/otelop/issues/23)) ([9d92bd8](https://github.com/mashiro/otelop/commit/9d92bd8ba030cbcdaeb170c350f018630eaa6b01))
* **deps:** update dependency lucide-react to v1.8.0 ([#25](https://github.com/mashiro/otelop/issues/25)) ([e43b3ea](https://github.com/mashiro/otelop/commit/e43b3eaf1c3a48ec0e55f2e67d5ccceaf4f58ebc))

## [0.3.0](https://github.com/mashiro/otelop/compare/v0.2.0...v0.3.0) (2026-04-11)


### Features

* **metrics:** delta-ize cumulative metrics and add metric catalog ([#22](https://github.com/mashiro/otelop/issues/22)) ([c02f7c3](https://github.com/mashiro/otelop/commit/c02f7c343aa98e0482b97d0ffc85364b799a2ec4))


### Bug Fixes

* **store:** skip non-finite metric data points ([#19](https://github.com/mashiro/otelop/issues/19)) ([f001292](https://github.com/mashiro/otelop/commit/f001292437c01355d09bed3a45757c450c22650c))
* **store:** stringify non-finite double attributes ([#21](https://github.com/mashiro/otelop/issues/21)) ([695fe1f](https://github.com/mashiro/otelop/commit/695fe1f3880b2fb49ed3e2e1a70606a08ff99a07))

## [0.2.0](https://github.com/mashiro/otelop/compare/v0.1.0...v0.2.0) (2026-04-11)


### Features

* **api:** add GraphQL API, migrate frontend, drop REST ([#11](https://github.com/mashiro/otelop/issues/11)) ([ddc2583](https://github.com/mashiro/otelop/commit/ddc25839e16d59850a4a1ddd4640fb179d05cb60))
* **frontend:** add Venn-style app logo and favicon ([4ae5112](https://github.com/mashiro/otelop/commit/4ae51124cfac61186b39d92b7536739ced2ce078))


### Bug Fixes

* **deps:** update all non-major dependencies ([#12](https://github.com/mashiro/otelop/issues/12)) ([1f7d0eb](https://github.com/mashiro/otelop/commit/1f7d0eb9e45f741b788ae374f5ba2513f4dfa568))

## 0.1.0 (2026-04-11)


### Features

* add --debug flag for self-telemetry and structured logging ([16345f5](https://github.com/mashiro/otelop/commit/16345f5440c348d5abf52416bf1871073abd114b))
* add brotli/gzip/deflate HTTP response compression ([27ecc4e](https://github.com/mashiro/otelop/commit/27ecc4e0955abc87cdfc7b39323d4fcae3519e43))
* add clear button to search input ([5d2e3ec](https://github.com/mashiro/otelop/commit/5d2e3ec58b8e5ae1a4fa4cd5bbdfb530c2bd55e6))
* add CLI flags for runtime configuration ([28b7732](https://github.com/mashiro/otelop/commit/28b7732ce3b7315e9b0cffdcfcf49e201e0cb3d4))
* add collapsible long values in KV component with line-clamp ([9fbe16f](https://github.com/mashiro/otelop/commit/9fbe16f13c13caca9d06f34541a47e4aba2b6317))
* add collapsible spans in waterfall view ([788b6b0](https://github.com/mashiro/otelop/commit/788b6b0cb89fcfa03c8cdea18dd1475c2ff74f6c))
* add custom observable metrics for store usage and WebSocket clients ([e53736f](https://github.com/mashiro/otelop/commit/e53736fd96f38ae411b523afb0c9665a7b19ce31))
* add description column to metrics list and include it in search ([57a2c06](https://github.com/mashiro/otelop/commit/57a2c06ab47239969c2fd0d4621a175ebf1aaf61))
* add hover tooltip to metric chart ([9f98a9b](https://github.com/mashiro/otelop/commit/9f98a9b7906b74f0a24554993615740f5967bfeb))
* add install task for backend and frontend deps ([3567b5e](https://github.com/mashiro/otelop/commit/3567b5e9fe6d748787346e0dd716bb55a9b93cc8))
* add instant custom tooltip for waterfall span labels ([fb5fe60](https://github.com/mashiro/otelop/commit/fb5fe609300bd2ff15fce3859878abd423fe125a))
* add JSON export for traces and logs with test infrastructure ([3915edf](https://github.com/mashiro/otelop/commit/3915edfb85e4dcafb975c463c2daaf5381fcc1bc))
* add light/dark/system theme switching ([7997146](https://github.com/mashiro/otelop/commit/7997146c1116f30ff32aa0add391393efc2aa178))
* add search and filtering for traces, metrics, and logs ([a0d2c05](https://github.com/mashiro/otelop/commit/a0d2c052d6ec7574c78cf6256a6e989bd32b402b))
* add service map with dependency graph visualization ([b5f490c](https://github.com/mashiro/otelop/commit/b5f490cb70bce0882c4adcd158bdc960a5bac26c))
* add status and trace ID to search filter fields ([10db463](https://github.com/mashiro/otelop/commit/10db463ef77c6f9e6e023d97ebf31eea999fe6d6))
* add store-level spans to HTTP handlers and use route-based span names ([8ece7ed](https://github.com/mashiro/otelop/commit/8ece7edaa8efac133258995ef07578a10c638b29))
* add visx tooltip to waterfall span labels ([46c2aa9](https://github.com/mashiro/otelop/commit/46c2aa9bfacffabceddca87b0c102d5c79d117a6))
* enable React Compiler for automatic memoization ([41b5ce2](https://github.com/mashiro/otelop/commit/41b5ce2ca1ba450c0c50b43bbf42473831379f83))
* group metric chart series by data point attributes ([96a5a1e](https://github.com/mashiro/otelop/commit/96a5a1ef65728c5a501d27a4195091e8d202090d))
* implement Phase 1 backend skeleton ([3001e88](https://github.com/mashiro/otelop/commit/3001e88a51aca233848fdf1d8223765ac81c0358))
* implement Phase 2 frontend foundation ([7bebf7c](https://github.com/mashiro/otelop/commit/7bebf7cfda2a638af92cd69a4fb1f8e4dc3694c3))
* implement Phase 3 detail views ([d47626f](https://github.com/mashiro/otelop/commit/d47626f1cb9429ee1930193e6bdda9700a652752))
* improve waterfall with timeline header, service indicators, and toned-down colors ([bcbb6c7](https://github.com/mashiro/otelop/commit/bcbb6c711737d63e248e8bc4a57e7449ecd0313f))
* link traces and logs by traceID for cross-navigation ([49248d3](https://github.com/mashiro/otelop/commit/49248d381de0c906b787b8b9554006ab0ff0e5fb))
* make max-data-points configurable via CLI flag ([73ff5ab](https://github.com/mashiro/otelop/commit/73ff5abc00cfef832d4176cc3ccf16f7cff2e024))
* redesign frontend with Dark Observatory theme ([ec5fa4a](https://github.com/mashiro/otelop/commit/ec5fa4a544e9526d186e84109a9a460e4f1a6324))
* **server:** log /api/* requests at debug level ([1b6a855](https://github.com/mashiro/otelop/commit/1b6a8552e6ac61b5298f7b3ae9b34bb240595663))
* sort metrics list by name by default ([19fc659](https://github.com/mashiro/otelop/commit/19fc6596eef933ef7ba428accd7ea0f7f816b668))
* sync client-side limits with server config via /api/config ([00ba91b](https://github.com/mashiro/otelop/commit/00ba91babcfaea84f45ae4a5651d495a6d67cbbf))


### Bug Fixes

* avoid closing CONNECTING WebSocket on StrictMode cleanup ([6fea52f](https://github.com/mashiro/otelop/commit/6fea52fa4c49a7eccedf65e9b3ec410e04c9b4df))
* clean up startup log output ([6111b94](https://github.com/mashiro/otelop/commit/6111b94decd5d60fadc80b18b2f0957fcfc70797))
* constrain expanded log detail row to table width ([426bdb7](https://github.com/mashiro/otelop/commit/426bdb7faf846bd6d3002786d1b3bf4a2f2d9209))
* deduplicate spans when merging traces ([6a058a0](https://github.com/mashiro/otelop/commit/6a058a0fd27ec83edaf5fe00cdc59bf06b5b6d25))
* extract shared KV component for stacked key-value layout ([7ba68b3](https://github.com/mashiro/otelop/commit/7ba68b38db25a4a79319f56f2c3b061b5470ec94))
* force text wrapping in KV values inside table cells ([58d7f48](https://github.com/mashiro/otelop/commit/58d7f487d846a63f55fbdfd4ef00ad72473e7094))
* handle invalid timestamps in span waterfall rendering ([5e6353d](https://github.com/mashiro/otelop/commit/5e6353d31ba541717e92875088577beb3e2bd6b9))
* improve color contrast across the dark theme ([fbb99f7](https://github.com/mashiro/otelop/commit/fbb99f7e049938c837b6ff0a3028b0e78f8489b7))
* improve metric chart axis readability ([ed8775b](https://github.com/mashiro/otelop/commit/ed8775bee067b35eb58b09cf565e6e7bf892f8ee))
* improve startup banner formatting ([46f1809](https://github.com/mashiro/otelop/commit/46f1809e25beb57e09f7ea6a558e008a973c47ee))
* improve waterfall tooltip style and remove truncation ([fd5ebc4](https://github.com/mashiro/otelop/commit/fd5ebc45849a8872fb177ab313485c3e2e7f3f02))
* increase horizontal padding on table cells ([19ae674](https://github.com/mashiro/otelop/commit/19ae674e0f1f799dd7f1f9c5d69dbd94c09546d1))
* keep metric detail view updated and reduce tab-content spacing ([4ba1975](https://github.com/mashiro/otelop/commit/4ba1975e87f4fecb310925860ae4125eed1a17f6))
* lighten detail view backgrounds for better readability ([57cc93b](https://github.com/mashiro/otelop/commit/57cc93ba24974ca2ff2cbc5fc80772f9e354e32a))
* make table header sticky so it stays visible while scrolling ([ee996a3](https://github.com/mashiro/otelop/commit/ee996a3e1b3f59ed9db4a860541bb900257d7dd4))
* merge metric data points for same service and name ([7dc6c06](https://github.com/mashiro/otelop/commit/7dc6c0662b05228b5d41929ef9047057de91ed05))
* metric chart tooltip shows all series, fix line rendering ([77f0fa8](https://github.com/mashiro/otelop/commit/77f0fa89f6d88936f2762ca2866248ee1d1d1d89))
* **metric-detail:** make the outer scroll area actually scroll ([#5](https://github.com/mashiro/otelop/issues/5)) ([af7bb7b](https://github.com/mashiro/otelop/commit/af7bb7bc4bf8751bc7a1ce1c6cea5777ee3a7cdf))
* migrate to @rolldown/plugin-babel and pin dependency versions ([4fd5ea9](https://github.com/mashiro/otelop/commit/4fd5ea93990d33a73e475468c7c9a8209733329c))
* move log JSON button to absolute position and enable debug in dev ([6c5d0a1](https://github.com/mashiro/otelop/commit/6c5d0a1874eaeab08dadcdadedf1726d80267205))
* pin Span Details header with close button above scroll area ([8145c8a](https://github.com/mashiro/otelop/commit/8145c8a51014a6dd1c1d518e9919824b8b9738d7))
* position duration label based on bar position to avoid overflow ([ea6bf52](https://github.com/mashiro/otelop/commit/ea6bf52c625609a9ee7d0fbc7be880b6f76590bc))
* prevent duplicate WebSocket connections in React StrictMode ([62f2a24](https://github.com/mashiro/otelop/commit/62f2a241e83b6658d1627592463ae495f4e5117e))
* prevent layout shift on tab switch with stable scrollbar gutter and fade-only animation ([6e88bcd](https://github.com/mashiro/otelop/commit/6e88bcdbfad9555ffe01118a24e3021b85f2a68c))
* prevent long log body from stretching detail layout ([8dce6cf](https://github.com/mashiro/otelop/commit/8dce6cf96a1f5f3cfeb5d9a57845de43173c15dc))
* remove leading blank line from startup banner ([4dfa2a7](https://github.com/mashiro/otelop/commit/4dfa2a7dfbd551d838694717cfe586e1ed34a3cf))
* remove overflow-x-auto from table container to enable sticky header ([993fcf1](https://github.com/mashiro/otelop/commit/993fcf1431736f22103db60bd267b3f155ea5cb9))
* remove SVG glow filter that clipped metric chart lines ([306b686](https://github.com/mashiro/otelop/commit/306b686af565e42ca5acca9ef119428179b9cf93))
* render waterfall tooltip in HTML layer outside ScrollArea ([7bba837](https://github.com/mashiro/otelop/commit/7bba837aec3f15041942d732f1e41b402b1b482d))
* resolve all lint and type errors ([bba1ebe](https://github.com/mashiro/otelop/commit/bba1ebe79c39fdd6ea201b27b5c09a2603ab6f78))
* restore log list scrolling with min-h-0 on ScrollArea ([46cdb21](https://github.com/mashiro/otelop/commit/46cdb2128a8c346b6daff8de69d6c0fc12b67382))
* restore scrollbar-gutter stable lost during CSS reorder ([841e985](https://github.com/mashiro/otelop/commit/841e9851cea7c45b1f15a6c406f2aae1c506051d))
* restore search clear button and persist input across tab switches ([d1636f6](https://github.com/mashiro/otelop/commit/d1636f66920180010f7ca4a90691b472862d40c6))
* restore stagger-row fade-in animation lost during CSS reorder ([b9dacc2](https://github.com/mashiro/otelop/commit/b9dacc21ced3783278d0be28d844755475033112))
* restore tab active colors in dark mode overridden by shadcn defaults ([58f58eb](https://github.com/mashiro/otelop/commit/58f58eb92e0149b59835044d1a28319226caecc5))
* rewrite SearchFilter without useEffect to fix input clearing bug ([8b51601](https://github.com/mashiro/otelop/commit/8b516018d03f4c16c691a6fc306ab27319b7b2b8))
* set cursor pointer on all interactive elements ([1fb42b9](https://github.com/mashiro/otelop/commit/1fb42b964275fe90b93d4e18312bd1263d13ac6b))
* show only span name in waterfall label, full name in tooltip ([ecb5de0](https://github.com/mashiro/otelop/commit/ecb5de0c915471b0c051c81dbf9b32a679f0a069))
* skip compression middleware for WebSocket upgrades ([0add5e2](https://github.com/mashiro/otelop/commit/0add5e29908e6fc586f75aae48f204f3292bb512))
* **store:** return empty slice from RingBuffer.Page when empty ([#3](https://github.com/mashiro/otelop/issues/3)) ([5075512](https://github.com/mashiro/otelop/commit/5075512a105c294c5e2260e48d648eda9fb681fa))
* style startup banner with bold cyan app name ([27f24fc](https://github.com/mashiro/otelop/commit/27f24fcae3bc131a8708b5344cccc13bf4a77c9f))
* suppress WebSocket error on React StrictMode double-mount ([d807afc](https://github.com/mashiro/otelop/commit/d807afca3593720592df5a75c2774951efe03a60))
* unify timeline tick units, add right edge label, and visible grid lines ([0baa8ba](https://github.com/mashiro/otelop/commit/0baa8ba6c7bb13d1b0f4efaa72777091ba0f46ba))
* use glass-card for detail views to match list containers ([7a0948b](https://github.com/mashiro/otelop/commit/7a0948b9a53bd835c2dfccc104add5b480cf00c7))
* use root span time range for waterfall scale ([8a720d7](https://github.com/mashiro/otelop/commit/8a720d7db3b7957cbe75bb22a80881a931be2983))
* use stacked key-value layout in span detail attributes ([43755cc](https://github.com/mashiro/otelop/commit/43755cc37362ddcfc72e260885cc9096253ff531))
* use Temporal API for nanosecond-precision waterfall rendering ([7e8721b](https://github.com/mashiro/otelop/commit/7e8721bfebab2035c6eb5ffa39940cc0c5c5e5fd))

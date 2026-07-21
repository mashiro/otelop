# Changelog

## [1.1.0](https://github.com/mashiro/otelop/compare/v1.0.0...v1.1.0) (2026-07-21)


### Features

* **frontend:** add 3h and 12h time range options ([#177](https://github.com/mashiro/otelop/issues/177)) ([07993fd](https://github.com/mashiro/otelop/commit/07993fd808d75b030e9d8e63d3da1ae39dda9fe6))
* **frontend:** bounded sliding render window with configurable size ([#189](https://github.com/mashiro/otelop/issues/189)) ([66b6556](https://github.com/mashiro/otelop/commit/66b6556c9e282a1be1d15404fbd0efd501666501))
* **server:** remove MCP server endpoint ([#179](https://github.com/mashiro/otelop/issues/179)) ([c6fa723](https://github.com/mashiro/otelop/commit/c6fa723bb508c2375c4cb89a66f5a0258a6c3c01))


### Bug Fixes

* **cli:** shut down daemon when collector fails after startup ([#182](https://github.com/mashiro/otelop/issues/182)) ([9733f7c](https://github.com/mashiro/otelop/commit/9733f7c557f4ae3982abf3dd84b82341b0264bd2))
* **config:** bind Web UI/API to loopback by default ([#181](https://github.com/mashiro/otelop/issues/181)) ([f2c65c9](https://github.com/mashiro/otelop/commit/f2c65c9e4c3fdc63a3180c92d1961b22e9e29b9c))
* **deps:** update all non-major dependencies ([#190](https://github.com/mashiro/otelop/issues/190)) ([a30f21f](https://github.com/mashiro/otelop/commit/a30f21f2a6dd1c749d5dbbb970d26728d3b3d85b))
* **deps:** update dependency jotai to v2.20.2 ([#173](https://github.com/mashiro/otelop/issues/173)) ([4e61f8e](https://github.com/mashiro/otelop/commit/4e61f8eabdecadaac06bf9f85658a7d76fb1874f))
* **frontend:** show time range labels instead of raw values in select trigger ([#178](https://github.com/mashiro/otelop/issues/178)) ([014a2df](https://github.com/mashiro/otelop/commit/014a2df1271155cbc56942f76c9d0f7c55b1b38b))
* **graphql:** bound query depth, length, and page limits ([#183](https://github.com/mashiro/otelop/issues/183)) ([801627c](https://github.com/mashiro/otelop/commit/801627c512ed955606353e3d03352b911b3287fe))
* **server:** restrict WS origins, add CSRF and Host validation ([#180](https://github.com/mashiro/otelop/issues/180)) ([8ee6dde](https://github.com/mashiro/otelop/commit/8ee6dde8666a99dae16c56fb65952caad36ee556))


### Performance Improvements

* **frontend:** batch WebSocket deliveries into throttled store updates ([#192](https://github.com/mashiro/otelop/issues/192)) ([ddfb57d](https://github.com/mashiro/otelop/commit/ddfb57d968cdeccc89edd2bbf5ddc9ae3f676bd7))
* **frontend:** parse timestamps once at the ingest boundary ([#191](https://github.com/mashiro/otelop/issues/191)) ([47be9a9](https://github.com/mashiro/otelop/commit/47be9a9927f5f8386cac5b8057f0cf9bb1787cb8))

## [1.0.0](https://github.com/mashiro/otelop/compare/v0.7.0...v1.0.0) (2026-07-15)


### ⚠ BREAKING CHANGES

* **storage:** replace in-memory ring buffers with embedded DuckDB persistence ([#165](https://github.com/mashiro/otelop/issues/165))
* **storage:** Remove the per-signal capacity settings and replace them with DuckDB-backed storage retention and size limits.
* **storage:** the config keys trace_cap, metric_cap, log_cap, and max_data_points (and their CLI flags/env vars) are removed. Use the new [storage] section: path, retention (default "7d"), max_size (default "4GB"), or --storage-path/--retention/--max-size.

### Features

* add server-backed telemetry exploration ([66bcb11](https://github.com/mashiro/otelop/commit/66bcb11fc29b9e13147c1d48a1fbc06b81c085f0))
* **cli:** add otelop info and focus status on process state ([ee10e35](https://github.com/mashiro/otelop/commit/ee10e35717a33f1c7ce22fb7ead900bff3bd6446))
* **frontend:** add time-range selector to metric detail chart ([#157](https://github.com/mashiro/otelop/issues/157)) ([90fc074](https://github.com/mashiro/otelop/commit/90fc074587d216f05983eea7cebb5b8fed2e1405))
* **frontend:** default metric range to 1h, add 6h/24h options, persist range in URL ([f564650](https://github.com/mashiro/otelop/commit/f564650f2d71018bd261035ef0df321cc0e00fe7))
* **frontend:** navigate metric time windows ([f804401](https://github.com/mashiro/otelop/commit/f8044016666f29d4af1ee0cebd285ac6eb760b37))
* **frontend:** remove header clear-all button ([b76dfba](https://github.com/mashiro/otelop/commit/b76dfbaac10eb18354be20d75119b2a33dbab8fc))
* **frontend:** scope trace/log lists by time range with server-side pagination ([4e4e10a](https://github.com/mashiro/otelop/commit/4e4e10a699b0912e4ce95435694dd361d4d9d227)), closes [#160](https://github.com/mashiro/otelop/issues/160)
* **frontend:** server-backed time ranges, facet aggregation, and range-scoped totals ([1580340](https://github.com/mashiro/otelop/commit/1580340ffc6ef1d48c814e0a3316ae27af846f11))
* **frontend:** show log and data point details in sidebars, sync log selection to URL ([#155](https://github.com/mashiro/otelop/issues/155)) ([00591a1](https://github.com/mashiro/otelop/commit/00591a1ffffe24f698b2362d37a782448f640c4a))
* **frontend:** sync active tab and detail selection to URL ([#151](https://github.com/mashiro/otelop/issues/151)) ([f1d61ba](https://github.com/mashiro/otelop/commit/f1d61bae193aad43ba4bb607001548a938ca9a41))
* **frontend:** unify time range controls ([da929c8](https://github.com/mashiro/otelop/commit/da929c893cb2fbf5431cefc779d2621fe22e8c8d))
* **graphql:** use cursor-based signal pagination ([798d2c1](https://github.com/mashiro/otelop/commit/798d2c1cbe876d4dfe0b7270c23eaa2090385d37))
* **metrics:** group histogram distribution statistics ([676bb15](https://github.com/mashiro/otelop/commit/676bb15f4a67d89b10b039ee60cbd9f2a51eb5a7))
* **metrics:** preserve raw distributions and expose percentiles ([98f466c](https://github.com/mashiro/otelop/commit/98f466c5b5bdb769e5ffd0ff5f58c93565fda8a3))
* **search:** search across retained telemetry ([48966d0](https://github.com/mashiro/otelop/commit/48966d0209fd711e4bb5b56bb48d0b15b0fa38ed))
* **search:** server-side search for trace/log lists ([3bc545a](https://github.com/mashiro/otelop/commit/3bc545a094fb0b0aa1a68a52e87b5125b616fd95)), closes [#161](https://github.com/mashiro/otelop/issues/161)
* **storage:** add DuckDB telemetry ([529adc9](https://github.com/mashiro/otelop/commit/529adc903911d75dd658796780062a66164698d7))
* **storage:** add write pipeline telemetry ([d730bfd](https://github.com/mashiro/otelop/commit/d730bfddd5e838052f7bcb073fea59556e011df4))
* **storage:** replace in-memory buffers with DuckDB ([64c88d9](https://github.com/mashiro/otelop/commit/64c88d9014543a5856de1b73d4a162b282f1aad9))
* **storage:** replace in-memory ring buffers with DuckDB persistence ([9661374](https://github.com/mashiro/otelop/commit/9661374ef9532d6d8e8286b2d7b369c0ca364e2d))
* **storage:** replace in-memory ring buffers with embedded DuckDB persistence ([#165](https://github.com/mashiro/otelop/issues/165)) ([20aadf2](https://github.com/mashiro/otelop/commit/20aadf2c9e2ac765f8f732411123fd2e913a331d))


### Bug Fixes

* **broadcast:** encode empty span events as arrays ([a2dec0b](https://github.com/mashiro/otelop/commit/a2dec0b5ee484673e2caf3f05049cbfb57690b97))
* **build:** update renamed mise task references ([7a6be7e](https://github.com/mashiro/otelop/commit/7a6be7e37f79f37a2310407e86f9d5509624b52c))
* **cli:** avoid stop timeout in debug mode ([e765efa](https://github.com/mashiro/otelop/commit/e765efad92e90f176d946b8ac93c0309f3e17cf8))
* **cli:** stop reporting a spurious timeout when the process exits near the deadline ([5428d6c](https://github.com/mashiro/otelop/commit/5428d6ce775d78fc8541c0b9da463f6c9239f88d)), closes [#163](https://github.com/mashiro/otelop/issues/163)
* **deps:** update all non-major dependencies ([#150](https://github.com/mashiro/otelop/issues/150)) ([7ff6224](https://github.com/mashiro/otelop/commit/7ff62244aed1caea5a53cf5af741abf6354369d9))
* **deps:** update dependency lucide-react to v1.24.0 ([#167](https://github.com/mashiro/otelop/issues/167)) ([b5500a0](https://github.com/mashiro/otelop/commit/b5500a063fd31dfdfa50e147c20ba0c2bd8a26a1))
* **frontend:** align retained-history pagination ([2c73078](https://github.com/mashiro/otelop/commit/2c730781d065f05746b7133a765feeb049c56313))
* **frontend:** distinguish live window from connection ([da2294b](https://github.com/mashiro/otelop/commit/da2294b836cb0be8f5e68c04512907a72aef9118))
* **frontend:** keep metrics search recoverable and search state consistent ([492e6f2](https://github.com/mashiro/otelop/commit/492e6f2fa587a828abb2e9755da876c590d508ff))
* **frontend:** label monotonic sums as increase ([b525624](https://github.com/mashiro/otelop/commit/b5256242d565df56e5b0f2dc5762c565e34023e0))
* **frontend:** make search submission IME-safe ([0d9ccd8](https://github.com/mashiro/otelop/commit/0d9ccd80e64bc1ac05c4b3c9e13cdaa387c93013))
* **frontend:** pin pagination sessions and keep live rows through page fetches ([cf39a3c](https://github.com/mashiro/otelop/commit/cf39a3cd1150294d473eb233cb1ae1d74e2c8874))
* **frontend:** preserve complete metric search results ([7651067](https://github.com/mashiro/otelop/commit/765106751fb17f39275a9a9ffeaeceeba824ac3a))
* **frontend:** resolve traces outside the current log window ([b9aff70](https://github.com/mashiro/otelop/commit/b9aff70d9f94e8290557ac0c1b96b1a6ed6f53d0))
* **frontend:** show latest gauge and distribution values ([a6d3ad0](https://github.com/mashiro/otelop/commit/a6d3ad09a7db360de033092b33efb6be5df48a17))
* **logs:** continue pagination beyond time window ([ff4aec5](https://github.com/mashiro/otelop/commit/ff4aec5056db4c0e8ffd57e298ebe6ed53e4ff0e))
* **logs:** fall back to observed timestamp ([8d9e8fe](https://github.com/mashiro/otelop/commit/8d9e8fee2181da459d6eb6a32b93b9a57bb305de))
* **metrics:** improve duration histogram precision ([eb29f9c](https://github.com/mashiro/otelop/commit/eb29f9cef6aa3617cb56cef164a93471701520a3))
* **metrics:** label p50 as median ([87a1c67](https://github.com/mashiro/otelop/commit/87a1c67e98e4825d21cbd87c09ee9cd9ef29b5a9))
* **metrics:** retain distribution during range changes ([8765f42](https://github.com/mashiro/otelop/commit/8765f42a8980035808b6b4e20e45abfc65ee55fe))
* **storage:** identify dropped oversized traces ([9835bb9](https://github.com/mashiro/otelop/commit/9835bb9a38e98176a0871736b866a941029de727))
* **storage:** scope metric series identity to resource and instrumentation scope ([8756257](https://github.com/mashiro/otelop/commit/8756257eb8fc5d77e3bfeaf1c1fd71d8baa54b19))
* **traces:** align time windows with trace start ([784fe91](https://github.com/mashiro/otelop/commit/784fe9113bf8498b49df7dc644148bbe7605effb))


### Performance Improvements

* **broadcast:** batch live update queries ([a1c97bd](https://github.com/mashiro/otelop/commit/a1c97bd12e624e2aeede3724db7f61d567e92a6b))
* **frontend:** fetch metric summaries and header totals on initial load ([09de110](https://github.com/mashiro/otelop/commit/09de11054119d8cf82a79a0bd86f7510eedfd3d1)), closes [#162](https://github.com/mashiro/otelop/issues/162)
* **graphql:** optimize telemetry list queries ([c40bb7c](https://github.com/mashiro/otelop/commit/c40bb7cbb35b8cd6bb6df6aeb11906a9514c476f))
* **graphql:** stop N+1 trace-detail fetches and cap self-telemetry field spans ([cc49793](https://github.com/mashiro/otelop/commit/cc49793ac448b15ab5eeac52aa5185cd1d18de86))
* **metrics:** coalesce broadcast readbacks ([c4032b4](https://github.com/mashiro/otelop/commit/c4032b4e6c433ca1663823f020f9948d0849359d))
* **storage:** optimize trace processing ([74eced2](https://github.com/mashiro/otelop/commit/74eced20dfa706a3c00920499b2ddb582857d8ef))

## [0.7.0](https://github.com/mashiro/otelop/compare/v0.6.2...v0.7.0) (2026-07-06)


### Features

* **metrics:** expand data point rows to reveal full attributes and resource ([#149](https://github.com/mashiro/otelop/issues/149)) ([c7c8de6](https://github.com/mashiro/otelop/commit/c7c8de67b6cf49f05fbfb104f369f1b0e74c6446))
* **metrics:** expose raw cumulative alongside delta on DataPoint ([#142](https://github.com/mashiro/otelop/issues/142)) ([6900312](https://github.com/mashiro/otelop/commit/6900312a78f9deceecfc634ab2820d8c8b434b71))
* **metrics:** show session-total stat tiles for delta and cumulative Counters ([#148](https://github.com/mashiro/otelop/issues/148)) ([dc55353](https://github.com/mashiro/otelop/commit/dc5535394f652a8c0f43891b9c7d123008a11247))


### Bug Fixes

* **deps:** update all non-major dependencies ([41b5dc4](https://github.com/mashiro/otelop/commit/41b5dc4200934516b3c708c58d939686513f4a0b))
* **deps:** update all non-major dependencies ([7feecc5](https://github.com/mashiro/otelop/commit/7feecc5a3993dd14eda311e2c8695d38f8f6e8c9))
* **deps:** update all non-major dependencies ([3a50443](https://github.com/mashiro/otelop/commit/3a50443ae180eac9b261277ce1660e1c6f5d8b8b))
* **deps:** update all non-major dependencies ([#135](https://github.com/mashiro/otelop/issues/135)) ([d4c0382](https://github.com/mashiro/otelop/commit/d4c038288cb97a7775994e478564ae899ea76494))
* **deps:** update all non-major dependencies ([#140](https://github.com/mashiro/otelop/issues/140)) ([5971c65](https://github.com/mashiro/otelop/commit/5971c654c86c7a6638bfa32aefbeafd25f727052))
* **deps:** update all non-major dependencies ([#143](https://github.com/mashiro/otelop/issues/143)) ([1974f84](https://github.com/mashiro/otelop/commit/1974f84aa1382e4938815ea4ddb987e3bfa4ec6f))
* **deps:** update all non-major dependencies to v1.21.0 ([1e3c570](https://github.com/mashiro/otelop/commit/1e3c570e74ebc83a4ee73391e646308bce41d2ed))
* **deps:** update all non-major dependencies to v1.21.0 ([#122](https://github.com/mashiro/otelop/issues/122)) ([b239d44](https://github.com/mashiro/otelop/commit/b239d441ba908f8b65032ff3a8c20af3fafd4094))
* **deps:** update dependency lucide-react to v1.23.0 ([ed3a1fb](https://github.com/mashiro/otelop/commit/ed3a1fb4c140f6457686f5b0c48929dad7762aa0))
* **deps:** update dependency lucide-react to v1.23.0 ([#146](https://github.com/mashiro/otelop/issues/146)) ([b2a3143](https://github.com/mashiro/otelop/commit/b2a3143ab0e3f062f3cae7ee2786e68a01266b21))
* **deps:** update dependency shadcn to v4.12.0 ([407762e](https://github.com/mashiro/otelop/commit/407762ec9a72b7c632aa8c953960b8e20d7033a1))
* **deps:** update dependency shadcn to v4.12.0 ([#141](https://github.com/mashiro/otelop/issues/141)) ([1134f56](https://github.com/mashiro/otelop/commit/1134f56d8a954d00ebde123d6674c455e825d243))
* **deps:** update dependency temporal-polyfill to v1 ([#138](https://github.com/mashiro/otelop/issues/138)) ([4678ac6](https://github.com/mashiro/otelop/commit/4678ac6c5b188cf60ffe37b33bda0f17fc1994a9))

## [0.6.2](https://github.com/mashiro/otelop/compare/v0.6.1...v0.6.2) (2026-06-21)


### Bug Fixes

* **ci:** grant packages:write to release-please workflow ([#68](https://github.com/mashiro/otelop/issues/68)) ([346d59d](https://github.com/mashiro/otelop/commit/346d59d96eda49412f521a91769636cfbdeae9f7))
* **deps:** update all non-major dependencies ([#100](https://github.com/mashiro/otelop/issues/100)) ([25931f5](https://github.com/mashiro/otelop/commit/25931f5b6e25c05b5ae486c9e3c75712ded22efc))
* **deps:** update all non-major dependencies ([#101](https://github.com/mashiro/otelop/issues/101)) ([7b9fe0d](https://github.com/mashiro/otelop/commit/7b9fe0d6d9e64904e013549226688c9214fb34cc))
* **deps:** update all non-major dependencies ([#103](https://github.com/mashiro/otelop/issues/103)) ([8b5ea2d](https://github.com/mashiro/otelop/commit/8b5ea2dde52ff785cb7cde9d6d1fc76604fdb8d8))
* **deps:** update all non-major dependencies ([#105](https://github.com/mashiro/otelop/issues/105)) ([feb4567](https://github.com/mashiro/otelop/commit/feb4567cb28b54fbfd2e8592d2220d8b6301b4a1))
* **deps:** update all non-major dependencies ([#106](https://github.com/mashiro/otelop/issues/106)) ([35e41e7](https://github.com/mashiro/otelop/commit/35e41e7b987e75d4fbed60d6afe8f6fce1b14ccc))
* **deps:** update all non-major dependencies ([#112](https://github.com/mashiro/otelop/issues/112)) ([08f0b40](https://github.com/mashiro/otelop/commit/08f0b404c920530356cd5d28bfd5266c419e096c))
* **deps:** update all non-major dependencies ([#117](https://github.com/mashiro/otelop/issues/117)) ([8b76ca9](https://github.com/mashiro/otelop/commit/8b76ca9bb756a4ffb05ee4eb781bc71269c43a38))
* **deps:** update all non-major dependencies ([#71](https://github.com/mashiro/otelop/issues/71)) ([19d7cf2](https://github.com/mashiro/otelop/commit/19d7cf23c96cbbd214e1a180ee5c78f7afc2cd27))
* **deps:** update all non-major dependencies ([#72](https://github.com/mashiro/otelop/issues/72)) ([6454744](https://github.com/mashiro/otelop/commit/64547445942cbaef0a1c40e4dd18b086a76be7a4))
* **deps:** update all non-major dependencies ([#79](https://github.com/mashiro/otelop/issues/79)) ([5a1420e](https://github.com/mashiro/otelop/commit/5a1420e1154627be25b67d532710da708a3900a1))
* **deps:** update all non-major dependencies ([#84](https://github.com/mashiro/otelop/issues/84)) ([5dd579c](https://github.com/mashiro/otelop/commit/5dd579cffba507fed2455865c245fa69c28b6117))
* **deps:** update all non-major dependencies ([#85](https://github.com/mashiro/otelop/issues/85)) ([0cc3201](https://github.com/mashiro/otelop/commit/0cc32017dd441185e4736175d680132ee117052f))
* **deps:** update all non-major dependencies ([#87](https://github.com/mashiro/otelop/issues/87)) ([8900160](https://github.com/mashiro/otelop/commit/8900160ddf1030d1d8ea510a6eebeceec1f27c8e))
* **deps:** update all non-major dependencies ([#94](https://github.com/mashiro/otelop/issues/94)) ([2cef4a2](https://github.com/mashiro/otelop/commit/2cef4a2e45bf8d97fd4af4dce0ae0ad1365bb70e))
* **deps:** update all non-major dependencies ([#96](https://github.com/mashiro/otelop/issues/96)) ([222c0dd](https://github.com/mashiro/otelop/commit/222c0dda546440da7b56b9356d6ed6ab30186681))
* **deps:** update all non-major dependencies ([#98](https://github.com/mashiro/otelop/issues/98)) ([1ffff8d](https://github.com/mashiro/otelop/commit/1ffff8d68b5d0ee1ddf4dc983a037fe67ecba7b0))
* **deps:** update all non-major dependencies to v1.20.0 ([#121](https://github.com/mashiro/otelop/issues/121)) ([e49b648](https://github.com/mashiro/otelop/commit/e49b64888f57333bc8fac9409235635b4c406c15))
* **deps:** update all non-major dependencies to v1.8.15 ([#119](https://github.com/mashiro/otelop/issues/119)) ([03f5f48](https://github.com/mashiro/otelop/commit/03f5f48c81847a23aaf6d6c8f4a101910d0bbda9))
* **deps:** update all non-major dependencies to v2.20.1 ([#114](https://github.com/mashiro/otelop/issues/114)) ([7f7296e](https://github.com/mashiro/otelop/commit/7f7296e64d6e3e023993f3653d603dc6b47d8b33))
* **deps:** update all non-major dependencies to v3.10.0 ([#118](https://github.com/mashiro/otelop/issues/118)) ([1251dd3](https://github.com/mashiro/otelop/commit/1251dd3dc0320cd2d2e1c478256065001f55b6a8))
* **deps:** update all non-major dependencies to v4.9.0 ([#104](https://github.com/mashiro/otelop/issues/104)) ([2bcc613](https://github.com/mashiro/otelop/commit/2bcc6136614fc544ca68579d0df2c6f800037e58))
* **deps:** update dependency @fontsource-variable/geist to v5.2.9 ([#92](https://github.com/mashiro/otelop/issues/92)) ([2e8298e](https://github.com/mashiro/otelop/commit/2e8298e69a210a61a4c65711cf93383ce60a157a))
* **deps:** update dependency lucide-react to v1.16.0 ([#88](https://github.com/mashiro/otelop/issues/88)) ([f58544a](https://github.com/mashiro/otelop/commit/f58544a034157e1fb148343e382942531da5cef3))
* **deps:** update dependency lucide-react to v1.17.0 ([#102](https://github.com/mashiro/otelop/issues/102)) ([f48fef8](https://github.com/mashiro/otelop/commit/f48fef87e5a4d5323904f741c4a78d2cf0d913da))
* **deps:** update dependency shadcn to v4.8.0 ([#95](https://github.com/mashiro/otelop/issues/95)) ([57d7e3b](https://github.com/mashiro/otelop/commit/57d7e3b2b2a5fa0686896571d2d6ba68e163628e))
* **deps:** update dependency shadcn to v4.8.1 ([#99](https://github.com/mashiro/otelop/issues/99)) ([d81c356](https://github.com/mashiro/otelop/commit/d81c3563224363833696bdf5263eca1ba543fdde))
* **deps:** update module github.com/modelcontextprotocol/go-sdk to v1.6.0 ([#73](https://github.com/mashiro/otelop/issues/73)) ([5874460](https://github.com/mashiro/otelop/commit/5874460e95bb5337ddbb379216fcb226552890c4))
* **deps:** update module github.com/urfave/cli/v3 to v3.9.0 ([#83](https://github.com/mashiro/otelop/issues/83)) ([92c88af](https://github.com/mashiro/otelop/commit/92c88afddbb206a11aee6aea04304177d9bf8a45))
* **deps:** update visx monorepo to v4 ([740c624](https://github.com/mashiro/otelop/commit/740c624274ad4085320dfc9f0e20c46c0da5bb44))
* **deps:** update visx monorepo to v4 ([#116](https://github.com/mashiro/otelop/issues/116)) ([af790ae](https://github.com/mashiro/otelop/commit/af790aebe0b3af7cd8410339afc0e50eb37e2d07))
* **logs:** assign stable UUIDv7 ids to log records ([d6487b8](https://github.com/mashiro/otelop/commit/d6487b81fbd407d67faa9528c68c3d7cb9ef62c9))
* **logs:** assign stable UUIDv7 ids to log records ([#129](https://github.com/mashiro/otelop/issues/129)) ([8561e55](https://github.com/mashiro/otelop/commit/8561e558bb204cf2f65da42334fce74b76eb1e11))
* **metrics:** assign stable UUIDv7 ids to data points and merge idempotently ([56f51d0](https://github.com/mashiro/otelop/commit/56f51d05500a219bf0bf2a4f21a122fec98b321a))
* **metrics:** assign stable UUIDv7 ids to data points and merge idempotently ([#126](https://github.com/mashiro/otelop/issues/126)) ([c55bf2b](https://github.com/mashiro/otelop/commit/c55bf2b35a70c17d410e67db613a8e9354033168))

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

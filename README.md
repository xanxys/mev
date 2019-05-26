# me/v: VRM Editor

ブラウザで使えるVRMエディター(予定)。

* 最新安定版: https://xanxys.github.io/mev/

## Roadmap

1. VRM component (bone) editing

2. VRM material editing (simple things: hue shift / resize / download / upload)

3. FBX importing

## Using as VRM loader library (not officially supported yet)

You will need:

* vrm.js
* vrm-materials.js
* (external resource) three.js (R103)

## Development

Useful VS.code extensions


- `Live Server` (launches local HTTP file server, necessary for loading ES6 type="module" scripts)

Open `test.html` to check unit test result.
(you need to launch a HTTP server to server test data (not included in this repo for copyright reason))

## License

- non-third_party: MIT license, written by xyx
- third_party/shaders: https://github.com/rdrgn/three-vrm

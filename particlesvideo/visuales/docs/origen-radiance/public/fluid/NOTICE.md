# Attribution

This project began from the public reference implementation
[`kotsoft/particle_based_viscoelastic_fluid`](https://github.com/kotsoft/particle_based_viscoelastic_fluid)
at commit `3238340fbd1e26665ac2a7b3e9ca5b42bb4f368e`.

The original implementation is available under the MIT License; its license is
retained in [`LICENSE`](LICENSE). The multi-material solver and application
layer in `src/` are a clean-room extension based on the published
particle-based viscoelastic-fluid method by Clavet, Beaudoin, and Poulin.

For exact local compatibility testing, `src/vendor/grantkot/` contains the
public `pvfs2d_v2_7.js` and `pvfs2d_v2_7.wasm` distribution served by
<https://www.grantkot.com/ll/>. Those two files remain the work of Grant Kot
and are kept separate from this project's MIT-licensed clean-room code. No
license for redistributing that web distribution was identified on the demo
page; obtain the author's permission before publishing those vendor files.

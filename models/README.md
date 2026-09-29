# 3D models go here

Drop your 5 `.glb` files in this folder and name them:

    model-1.glb  model-2.glb  model-3.glb  model-4.glb  model-5.glb

Then open `demo/demo-api.js` and rename the products so each `model:` entry
matches what the model actually is.

Tips: use .glb (not .gltf + separate files); aim for under 10 MB each
(compress at https://gltf.report or with `npx @gltf-transform/cli optimize in.glb out.glb`);
GitHub rejects files over 100 MB and the web uploader stops at 25 MB.

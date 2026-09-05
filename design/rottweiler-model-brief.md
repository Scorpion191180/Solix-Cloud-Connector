# Rottweiler 3D model brief

References: `rottweiler-turnaround-v2.png` and the Meshy input crop
`rottweiler-left-profile-v2.png`

Create one realistic adult Rottweiler with correct breed proportions: powerful compact body, broad head, short black coat, natural floppy ears and precise rust/tan markings on muzzle, eyebrows, chest and lower legs. Neutral standing quadruped pose, all four paws on the ground, straight spine, no collar, no person, no scenery, no pedestal.

Runtime requirements:

- GLB with PBR materials and embedded textures
- mobile-friendly geometry, ideally 15,000–30,000 triangles
- quadruped rig with named bones
- animations: idle, walk, run, bark, eat/head down, drink, lie down/sleep and stand up
- forward axis and ground contact verified before export
- black fur must retain visible detail instead of becoming a featureless silhouette

Implemented workflow: Meshy Image-to-3D using the left-profile reference,
followed by Mesh2Motion's quadruped rig and animations. The exported GLB was
simplified, resized to 1024-pixel textures and meshopt-compressed. Keep the
generated asset's license/attribution record beside the final model.

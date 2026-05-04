// Havelandet — Garden Platform Scene v2
// Wide establishing shot of a full Danish garden — house, beds, pergola, paths,
// robot mower, sprinklers, beehive, fruit trees. Then the platform UI lifts
// out of the garden as floating panels. The camera flies through it all.

import * as THREE from 'three';

export function initScene() {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.matchMedia('(max-width: 720px)').matches;

  const Q = {
    grass: isMobile ? 4000 : 14000,
    flowers: isMobile ? 200 : 700,
    leaves: isMobile ? 60 : 200,
    pixelRatio: Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2),
    shadowMapSize: isMobile ? 1024 : 2048,
  };

  const canvas = document.getElementById('scene');
  if (!canvas) return () => {};

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobile,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Q.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14271d);
  scene.fog = new THREE.FogExp2(0x1c3527, 0.018);

  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(0, 8, 22);

  const PAL = {
    forest900: new THREE.Color('#0c1a13'),
    forest800: new THREE.Color('#14271d'),
    forest700: new THREE.Color('#1c3527'),
    forest500: new THREE.Color('#3a6249'),
    forest300: new THREE.Color('#7a9e88'),
    soil800: new THREE.Color('#3f2c20'),
    soil700: new THREE.Color('#5a4232'),
    soil500: new THREE.Color('#8b6f56'),
    mist: new THREE.Color('#ede8df'),
    mist50: new THREE.Color('#faf8f3'),
    gold: new THREE.Color('#c89441'),
    gold300: new THREE.Color('#ecc784'),
    autumn: new THREE.Color('#a87a2e'),
    skyDawn: new THREE.Color('#1c3527'),
    skyMorn: new THREE.Color('#7a9e88'),
    skyNoon: new THREE.Color('#c5d4ca'),
    skyGold: new THREE.Color('#ecc784'),
    skyDusk: new THREE.Color('#b89c80'),
    stone: new THREE.Color('#9a9388'),
    roof: new THREE.Color('#3a2820'),
  };

  // ============ LIGHTS ============
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3027, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffeec8, 1.6);
  sun.position.set(20, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadowMapSize, Q.shadowMapSize);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  sun.shadow.bias = -0.0005;
  sun.shadow.radius = 6;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xb8d4e8, 0.35);
  fill.position.set(-12, 16, -8);
  scene.add(fill);

  // ============ HELPERS ============
  function makeRadialTexture(c1, c2) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, c1);
    grd.addColorStop(1, c2);
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function makeLeafTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#c89441';
    g.beginPath();
    g.ellipse(32, 32, 26, 14, Math.PI / 6, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#8b6f56';
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(8, 38); g.lineTo(56, 26); g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function makeGrassBladeGeometry() {
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array([-0.04, 0, 0, 0.04, 0, 0, 0, 1, 0]);
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setIndex([0, 1, 2]);
    g.computeVertexNormals();
    return g;
  }

  // ============ GROUND (large rolling lawn) ============
  const groundGeo = new THREE.PlaneGeometry(220, 220, 64, 64);
  // gentle rolling
  const gp = groundGeo.attributes.position.array;
  for (let i = 0; i < gp.length; i += 3) {
    const x = gp[i], y = gp[i + 1];
    gp[i + 2] = Math.sin(x * 0.06) * 0.4 + Math.cos(y * 0.05) * 0.5;
  }
  groundGeo.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({
    color: PAL.forest500.clone().multiplyScalar(0.85),
    roughness: 0.95, metalness: 0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  scene.add(ground);

  // Stone path that snakes through the garden
  const pathPoints = [];
  for (let t = 0; t <= 1; t += 0.02) {
    const u = t * Math.PI * 1.6 - 0.4;
    pathPoints.push(new THREE.Vector3(Math.sin(u) * 8 - 4, 0.02, t * 30 - 14));
  }
  const pathCurve = new THREE.CatmullRomCurve3(pathPoints);
  const pathGeo = new THREE.TubeGeometry(pathCurve, 80, 0.7, 6, false);
  const pathMat = new THREE.MeshStandardMaterial({ color: PAL.stone, roughness: 1 });
  const pathMesh = new THREE.Mesh(pathGeo, pathMat);
  pathMesh.position.y = -0.2;
  pathMesh.receiveShadow = true;
  scene.add(pathMesh);

  // ============ HOUSE (Danish summerhouse silhouette) ============
  const houseGroup = new THREE.Group();
  houseGroup.position.set(-9, 0, -16);
  scene.add(houseGroup);
  // walls
  const wallG = new THREE.BoxGeometry(8, 3.5, 5);
  const wallM = new THREE.MeshStandardMaterial({ color: PAL.mist, roughness: 0.8 });
  const wall = new THREE.Mesh(wallG, wallM);
  wall.position.y = 1.75; wall.castShadow = true; wall.receiveShadow = true;
  houseGroup.add(wall);
  // pitched roof — two slanted boxes
  const roofG = new THREE.BoxGeometry(8.4, 0.2, 3.2);
  const roofM = new THREE.MeshStandardMaterial({ color: PAL.roof, roughness: 0.7 });
  const roofL = new THREE.Mesh(roofG, roofM);
  roofL.position.set(0, 4.2, -0.9); roofL.rotation.x = -0.5;
  roofL.castShadow = true; houseGroup.add(roofL);
  const roofR = new THREE.Mesh(roofG, roofM);
  roofR.position.set(0, 4.2, 0.9); roofR.rotation.x = 0.5;
  roofR.castShadow = true; houseGroup.add(roofR);
  // chimney
  const chimG = new THREE.BoxGeometry(0.5, 1.2, 0.5);
  const chim = new THREE.Mesh(chimG, wallM);
  chim.position.set(2.5, 4.6, 0); chim.castShadow = true;
  houseGroup.add(chim);
  // door + windows (just emissive panels)
  const winM = new THREE.MeshStandardMaterial({ color: 0xffe5a8, emissive: 0xffd080, emissiveIntensity: 0.3, roughness: 0.4 });
  const winG = new THREE.PlaneGeometry(1, 1);
  for (const [x, y] of [[-2.5, 1.8], [-1, 1.8], [1, 1.8], [2.5, 1.8]]) {
    const w = new THREE.Mesh(winG, winM);
    w.position.set(x, y, 2.51);
    houseGroup.add(w);
  }
  const doorG = new THREE.PlaneGeometry(0.9, 1.8);
  const doorM = new THREE.MeshStandardMaterial({ color: PAL.forest700 });
  const door = new THREE.Mesh(doorG, doorM);
  door.position.set(0, 0.9, 2.51);
  houseGroup.add(door);

  // ============ PERGOLA ============
  const pergola = new THREE.Group();
  pergola.position.set(8, 0, -2);
  scene.add(pergola);
  const postM = new THREE.MeshStandardMaterial({ color: PAL.soil700, roughness: 0.9 });
  const postG = new THREE.BoxGeometry(0.18, 2.6, 0.18);
  for (const [x, z] of [[-1.5, -1.2], [1.5, -1.2], [-1.5, 1.2], [1.5, 1.2]]) {
    const p = new THREE.Mesh(postG, postM);
    p.position.set(x, 1.3, z); p.castShadow = true;
    pergola.add(p);
  }
  const beamG = new THREE.BoxGeometry(3.4, 0.12, 0.12);
  for (let i = -1.0; i <= 1.0; i += 0.3) {
    const b = new THREE.Mesh(beamG, postM);
    b.position.set(0, 2.55, i); b.castShadow = true;
    pergola.add(b);
  }

  // ============ RAISED GARDEN BEDS (vegetable patches) ============
  const beds = new THREE.Group();
  scene.add(beds);
  function addBed(x, z, w, d) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const frameM = new THREE.MeshStandardMaterial({ color: PAL.soil700, roughness: 0.9 });
    const sideXG = new THREE.BoxGeometry(w, 0.3, 0.1);
    const sideZG = new THREE.BoxGeometry(0.1, 0.3, d);
    const s1 = new THREE.Mesh(sideXG, frameM); s1.position.set(0, 0.15, d / 2); s1.castShadow = true; g.add(s1);
    const s2 = new THREE.Mesh(sideXG, frameM); s2.position.set(0, 0.15, -d / 2); s2.castShadow = true; g.add(s2);
    const s3 = new THREE.Mesh(sideZG, frameM); s3.position.set(w / 2, 0.15, 0); s3.castShadow = true; g.add(s3);
    const s4 = new THREE.Mesh(sideZG, frameM); s4.position.set(-w / 2, 0.15, 0); s4.castShadow = true; g.add(s4);
    // soil
    const soilM = new THREE.MeshStandardMaterial({ color: PAL.soil800, roughness: 1 });
    const soilMesh = new THREE.Mesh(new THREE.BoxGeometry(w - 0.05, 0.25, d - 0.05), soilM);
    soilMesh.position.y = 0.15; soilMesh.receiveShadow = true; g.add(soilMesh);
    // little plants in rows
    const plantM = new THREE.MeshStandardMaterial({ color: PAL.forest500, roughness: 0.7 });
    const cols = Math.floor(w / 0.4), rows = Math.floor(d / 0.4);
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (Math.random() < 0.4) continue;
        const h = 0.15 + Math.random() * 0.25;
        const pl = new THREE.Mesh(new THREE.SphereGeometry(0.08 + Math.random() * 0.05, 6, 5), plantM);
        pl.scale.set(1, h * 4, 1);
        pl.position.set((i - cols / 2 + 0.5) * 0.4, 0.28 + h / 2, (j - rows / 2 + 0.5) * 0.4);
        pl.castShadow = true;
        g.add(pl);
      }
    }
    beds.add(g);
  }
  addBed(2, -8, 3, 1.5);
  addBed(-3, -10, 2.5, 1.5);
  addBed(5, -10, 2, 1.5);
  addBed(-1, -6, 2, 1.5);

  // ============ FRUIT TREES ============
  const trees = new THREE.Group();
  scene.add(trees);
  const trunkM = new THREE.MeshStandardMaterial({ color: PAL.soil700, roughness: 0.9 });
  const canopyM = new THREE.MeshStandardMaterial({ color: PAL.forest500, roughness: 0.8 });
  const canopyAlt = new THREE.MeshStandardMaterial({ color: PAL.forest300, roughness: 0.85 });
  function addTree(x, z, scale = 1, alt = false) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * scale, 0.25 * scale, 2 * scale, 8), trunkM);
    trunk.position.y = 1 * scale; trunk.castShadow = true;
    g.add(trunk);
    const layers = 3;
    for (let i = 0; i < layers; i++) {
      const cs = (1.6 - i * 0.3) * scale;
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(cs, 1), alt ? canopyAlt : canopyM);
      c.position.set((Math.random() - 0.5) * 0.4 * scale, (1.8 + i * 0.7) * scale, (Math.random() - 0.5) * 0.4 * scale);
      c.castShadow = true;
      g.add(c);
    }
    trees.add(g);
  }
  addTree(-14, -8, 1.4);
  addTree(-12, -3, 1.1, true);
  addTree(13, -10, 1.3);
  addTree(15, -4, 1.0, true);
  addTree(-18, -14, 1.6);
  addTree(18, -14, 1.5, true);
  addTree(-16, 4, 1.2);
  addTree(16, 5, 1.2, true);
  addTree(0, -22, 1.8);
  addTree(-22, -2, 1.4, true);
  addTree(22, -2, 1.4);

  // distant tree-line silhouette
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 60 + Math.random() * 30;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r - 20;
    addTree(x, z, 1.5 + Math.random() * 1.5, Math.random() > 0.5);
  }

  // ============ HEDGE (boundary) ============
  const hedgeM = new THREE.MeshStandardMaterial({ color: PAL.forest700, roughness: 0.9 });
  function addHedgeRow(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    const segs = Math.floor(len / 0.6);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.5 + Math.random() * 0.15, 6, 5), hedgeM);
      h.position.set(x1 + dx * t, 0.5 + Math.random() * 0.1, z1 + dz * t);
      h.scale.set(1, 1.2, 1);
      h.castShadow = true; h.receiveShadow = true;
      trees.add(h);
    }
  }
  addHedgeRow(-25, 8, 25, 8);
  addHedgeRow(-25, -22, -25, 8);
  addHedgeRow(25, -22, 25, 8);

  // ============ POND ============
  const pondGeo = new THREE.CircleGeometry(2.2, 32);
  const pondMat = new THREE.MeshStandardMaterial({
    color: 0x3a5870, roughness: 0.2, metalness: 0.6,
    transparent: true, opacity: 0.9,
  });
  const pond = new THREE.Mesh(pondGeo, pondMat);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(-5, 0.04, -2);
  pond.receiveShadow = true;
  scene.add(pond);
  // pond rim
  const rimGeo = new THREE.TorusGeometry(2.2, 0.18, 6, 32);
  const rim = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ color: PAL.stone, roughness: 1 }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(-5, 0.06, -2);
  rim.castShadow = true; rim.receiveShadow = true;
  scene.add(rim);

  // ============ INSTANCED GRASS (huge field) ============
  const grassGeom = makeGrassBladeGeometry();
  const grassMat = new THREE.MeshStandardMaterial({
    color: PAL.forest500, roughness: 0.85, side: THREE.DoubleSide,
  });
  const grass = new THREE.InstancedMesh(grassGeom, grassMat, Q.grass);
  grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(grass);
  const grassInst = new Array(Q.grass);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < Q.grass; i++) {
    let x, z, ok = false, tries = 0;
    while (!ok && tries < 10) {
      x = (Math.random() - 0.5) * 50;
      z = (Math.random() - 0.5) * 50 - 6;
      const dHouse = Math.hypot(x + 9, z + 16);
      const dPond = Math.hypot(x + 5, z + 2);
      if (dHouse > 6 && dPond > 2.5) ok = true;
      tries++;
    }
    const h = 0.18 + Math.random() * 0.28;
    const rot = Math.random() * Math.PI;
    const yOff = Math.sin(x * 0.06) * 0.4 + Math.cos(z * 0.05) * 0.5;
    grassInst[i] = { x, z, h, rot, yOff, phase: Math.random() * Math.PI * 2 };
    dummy.position.set(x, yOff, z);
    dummy.scale.set(1, h, 1);
    dummy.rotation.set(0, rot, 0);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
  }
  grass.instanceMatrix.needsUpdate = true;

  // ============ FLOWERS ============
  const flowerGeom = new THREE.IcosahedronGeometry(0.06, 0);
  flowerGeom.scale(1, 0.7, 1);
  flowerGeom.translate(0, 0.25, 0);
  const flowerMat = new THREE.MeshStandardMaterial({ color: PAL.gold300, roughness: 0.6, side: THREE.DoubleSide });
  const flowers = new THREE.InstancedMesh(flowerGeom, flowerMat, Q.flowers);
  flowers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(flowers);
  const flowerInst = new Array(Q.flowers);
  const flowerColors = [PAL.gold300, PAL.gold, PAL.mist, new THREE.Color('#f5b860'), new THREE.Color('#e89090'), new THREE.Color('#c890b8')];
  const flowerColorArr = new Float32Array(Q.flowers * 3);
  for (let i = 0; i < Q.flowers; i++) {
    let x, z, ok = false, tries = 0;
    while (!ok && tries < 10) {
      x = (Math.random() - 0.5) * 40;
      z = (Math.random() - 0.5) * 40 - 6;
      const dHouse = Math.hypot(x + 9, z + 16);
      const dPond = Math.hypot(x + 5, z + 2);
      if (dHouse > 6 && dPond > 2.8) ok = true;
      tries++;
    }
    const s = 0.6 + Math.random() * 1.2;
    const yOff = Math.sin(x * 0.06) * 0.4 + Math.cos(z * 0.05) * 0.5;
    flowerInst[i] = { x, z, s, yOff, phase: Math.random() * Math.PI * 2 };
    dummy.position.set(x, yOff, z);
    dummy.scale.set(s, s, s);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
    const c = flowerColors[i % flowerColors.length];
    flowerColorArr[i * 3] = c.r; flowerColorArr[i * 3 + 1] = c.g; flowerColorArr[i * 3 + 2] = c.b;
  }
  flowers.instanceColor = new THREE.InstancedBufferAttribute(flowerColorArr, 3);
  flowers.instanceMatrix.needsUpdate = true;

  // ============ ROBOT MOWER ============
  function makeMower() {
    const g = new THREE.Group();
    const bodyM = new THREE.MeshStandardMaterial({ color: PAL.mist, roughness: 0.4, metalness: 0.2 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.7), bodyM);
    body.position.y = 0.13; body.castShadow = true; g.add(body);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), bodyM);
    dome.scale.set(1, 0.4, 1.15); dome.position.y = 0.22; dome.castShadow = true; g.add(dome);
    const stripM = new THREE.MeshStandardMaterial({ color: PAL.gold, emissive: PAL.gold, emissiveIntensity: 0.4 });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.02, 0.08), stripM);
    strip.position.set(0, 0.21, 0.27); g.add(strip);
    const wheelM = new THREE.MeshStandardMaterial({ color: PAL.forest900 });
    const wheelG = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 12); wheelG.rotateZ(Math.PI / 2);
    [[-0.27, 0.09, 0.25], [0.27, 0.09, 0.25], [-0.27, 0.09, -0.25], [0.27, 0.09, -0.25]].forEach(p => {
      const w = new THREE.Mesh(wheelG, wheelM); w.position.set(...p); g.add(w);
    });
    return g;
  }
  const mower = makeMower();
  mower.position.set(2, 0, -4);
  scene.add(mower);

  // mowing trail (lighter strip showing where it's cut)
  const trailGeo = new THREE.RingGeometry(2.5, 2.7, 64);
  const trailMat = new THREE.MeshBasicMaterial({ color: PAL.forest300, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
  const trail = new THREE.Mesh(trailGeo, trailMat);
  trail.rotation.x = -Math.PI / 2;
  trail.position.set(2, 0.03, -4);
  scene.add(trail);

  // ============ SPRINKLER PARTICLES (multiple zones) ============
  const sprinklerZones = [
    { x: 5, z: -10, h: 0.4 },
    { x: -3, z: -10, h: 0.4 },
    { x: 2, z: -8, h: 0.4 },
    { x: -1, z: -6, h: 0.4 },
  ];
  const perZone = isMobile ? 60 : 140;
  const totalSpr = sprinklerZones.length * perZone;
  const sprGeo = new THREE.BufferGeometry();
  const spPos = new Float32Array(totalSpr * 3);
  const spVel = new Float32Array(totalSpr * 3);
  const spZone = new Float32Array(totalSpr);
  for (let z = 0; z < sprinklerZones.length; z++) {
    const zd = sprinklerZones[z];
    for (let i = 0; i < perZone; i++) {
      const idx = z * perZone + i;
      spPos[idx * 3] = zd.x; spPos[idx * 3 + 1] = zd.h; spPos[idx * 3 + 2] = zd.z;
      const a = Math.random() * Math.PI * 2;
      const speed = 0.06 + Math.random() * 0.05;
      spVel[idx * 3] = Math.cos(a) * speed;
      spVel[idx * 3 + 1] = 0.09 + Math.random() * 0.04;
      spVel[idx * 3 + 2] = Math.sin(a) * speed;
      spZone[idx] = z;
    }
  }
  sprGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  sprGeo.setAttribute('velocity', new THREE.BufferAttribute(spVel, 3));
  const sprMat = new THREE.PointsMaterial({
    color: 0xc8e0ee, size: isMobile ? 0.04 : 0.03,
    transparent: true, opacity: 0,
    map: makeRadialTexture('rgba(220,240,255,1)', 'rgba(220,240,255,0)'),
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const sprinklers = new THREE.Points(sprGeo, sprMat);
  sprinklers.frustumCulled = false;
  scene.add(sprinklers);

  // ============ POLLEN / FIREFLIES ============
  const flyCount = isMobile ? 200 : 600;
  const flyGeo = new THREE.BufferGeometry();
  const flyPos = new Float32Array(flyCount * 3);
  const flySeed = new Float32Array(flyCount * 3);
  for (let i = 0; i < flyCount; i++) {
    flyPos[i * 3] = (Math.random() - 0.5) * 50;
    flyPos[i * 3 + 1] = 0.3 + Math.random() * 4;
    flyPos[i * 3 + 2] = (Math.random() - 0.5) * 50 - 6;
    flySeed[i * 3] = Math.random() * Math.PI * 2;
    flySeed[i * 3 + 1] = Math.random() * Math.PI * 2;
    flySeed[i * 3 + 2] = 0.4 + Math.random() * 1.0;
  }
  flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
  flyGeo.setAttribute('seed', new THREE.BufferAttribute(flySeed, 3));
  const flyMat = new THREE.PointsMaterial({
    color: 0xffe9a8, size: isMobile ? 0.10 : 0.08,
    transparent: true, opacity: 0,
    map: makeRadialTexture('rgba(255,235,170,1)', 'rgba(255,200,120,0)'),
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const fireflies = new THREE.Points(flyGeo, flyMat);
  scene.add(fireflies);

  // ============ FALLING LEAVES ============
  const leafCount = Q.leaves;
  const leafGeoP = new THREE.BufferGeometry();
  const leafPos = new Float32Array(leafCount * 3);
  const leafSeed = new Float32Array(leafCount * 3);
  for (let i = 0; i < leafCount; i++) {
    leafPos[i * 3] = (Math.random() - 0.5) * 50;
    leafPos[i * 3 + 1] = Math.random() * 12 + 2;
    leafPos[i * 3 + 2] = (Math.random() - 0.5) * 50 - 6;
    leafSeed[i * 3] = Math.random() * Math.PI * 2;
    leafSeed[i * 3 + 2] = 0.4 + Math.random() * 0.6;
  }
  leafGeoP.setAttribute('position', new THREE.BufferAttribute(leafPos, 3));
  leafGeoP.setAttribute('seed', new THREE.BufferAttribute(leafSeed, 3));
  const leafMatP = new THREE.PointsMaterial({
    color: 0xc89441, size: isMobile ? 0.18 : 0.14,
    transparent: true, opacity: 0,
    map: makeLeafTexture(), depthWrite: false, sizeAttenuation: true,
  });
  const fallLeaves = new THREE.Points(leafGeoP, leafMatP);
  scene.add(fallLeaves);

  // ============ FLYING DRONE-LINE / SCAN GRID overlay (Akt 04) ============
  // A glowing wireframe survey grid that snaps over the lawn — feels like the platform "scanning" the garden
  const gridGeo = new THREE.PlaneGeometry(34, 34, 34, 34);
  const gridMat = new THREE.MeshBasicMaterial({
    color: 0xecc784, transparent: true, opacity: 0,
    wireframe: true,
  });
  const scanGrid = new THREE.Mesh(gridGeo, gridMat);
  scanGrid.rotation.x = -Math.PI / 2;
  scanGrid.position.y = 0.08;
  scene.add(scanGrid);

  // Scan markers — pulsing dots over key features
  const markerData = [
    { x: 2, z: -4, label: 'mower' },
    { x: 5, z: -10, label: 'spr' },
    { x: -3, z: -10, label: 'spr' },
    { x: -5, z: -2, label: 'pond' },
    { x: -9, z: -16, label: 'house' },
    { x: 8, z: -2, label: 'pergola' },
    { x: -1, z: -6, label: 'bed' },
  ];
  const markers = new THREE.Group();
  scene.add(markers);
  const markerMat = new THREE.MeshBasicMaterial({
    color: 0xecc784, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  markerData.forEach(d => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 32), markerMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(d.x, 0.09, d.z);
    ring.userData.base = 0.4;
    markers.add(ring);
    // Vertical beam
    const beamG = new THREE.CylinderGeometry(0.04, 0.04, 4, 8, 1, true);
    const beamM = new THREE.MeshBasicMaterial({
      color: 0xecc784, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(beamG, beamM);
    beam.position.set(d.x, 2, d.z);
    beam.userData.isBeam = true;
    markers.add(beam);
  });

  // ============ FLOATING PLATFORM PANELS (Akt 04) ============
  // Three holographic UI panels that lift out of the garden — measurer / watering / AI
  function makePanel(color, size = [3, 2]) {
    const g = new THREE.Group();
    // Backing
    const bgM = new THREE.MeshBasicMaterial({
      color: 0xfaf8f3, transparent: true, opacity: 0,
    });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), bgM);
    g.add(bg);
    // Border
    const borderG = new THREE.EdgesGeometry(new THREE.PlaneGeometry(size[0], size[1]));
    const borderM = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
    const border = new THREE.LineSegments(borderG, borderM);
    g.add(border);
    // Accent strip
    const stripM = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(size[0] - 0.2, 0.04), stripM);
    strip.position.y = size[1] / 2 - 0.3;
    g.add(strip);
    g.userData.bgM = bgM;
    g.userData.borderM = borderM;
    g.userData.stripM = stripM;
    return g;
  }

  const panels = [
    { panel: makePanel(0x3a6249, [3.2, 2.0]), pos: [-6, 4.5, -2], ang: 0.3 },
    { panel: makePanel(0xc89441, [2.8, 1.8]), pos: [0, 5.2, -4], ang: 0 },
    { panel: makePanel(0x7a9e88, [3.0, 1.9]), pos: [6, 4.5, -2], ang: -0.3 },
  ];
  panels.forEach(p => {
    p.panel.position.set(...p.pos);
    p.panel.rotation.y = p.ang;
    p.panel.userData.startY = p.pos[1] - 3;
    scene.add(p.panel);
  });

  // ============ STARS ============
  const starCount = isMobile ? 200 : 500;
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(0.1 + Math.random() * 0.85);
    const R = 120;
    starPos[i * 3] = Math.sin(phi) * Math.cos(theta) * R;
    starPos[i * 3 + 1] = Math.cos(phi) * R;
    starPos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * R;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xfff4d6, size: 0.8, transparent: true, opacity: 0,
    map: makeRadialTexture('rgba(255,250,220,1)', 'rgba(255,250,220,0)'),
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ============ SUN ============
  const sunDiscMat = new THREE.SpriteMaterial({
    map: makeRadialTexture('rgba(255,240,200,1)', 'rgba(255,200,140,0)'),
    color: 0xfff0c8, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sunDisc = new THREE.Sprite(sunDiscMat);
  sunDisc.scale.set(14, 14, 1);
  sunDisc.position.set(20, 18, -50);
  scene.add(sunDisc);
  const sunHaloMat = new THREE.SpriteMaterial({
    map: makeRadialTexture('rgba(255,220,160,0.5)', 'rgba(255,220,160,0)'),
    color: 0xffd9a0, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sunHalo = new THREE.Sprite(sunHaloMat);
  sunHalo.scale.set(50, 50, 1);
  sunHalo.position.copy(sunDisc.position);
  scene.add(sunHalo);

  // Volumetric god-ray
  const rayMat = new THREE.SpriteMaterial({
    map: makeRadialTexture('rgba(255,225,170,0.85)', 'rgba(255,225,170,0)'),
    color: 0xffd9a0, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const rays = new THREE.Sprite(rayMat);
  rays.scale.set(60, 60, 1);
  rays.position.set(20, 18, -50);
  scene.add(rays);

  // ============ VIGNETTE ============
  const vignette = document.createElement('div');
  vignette.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:3;background:radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.5) 100%);opacity:0;transition:opacity 600ms ease-out;mix-blend-mode:multiply;';
  document.body.appendChild(vignette);

  // ============ SCROLL STATE ============
  const stage = document.querySelector('.stage');
  const heroIntro = document.querySelector('.hero-intro');
  const scrollCue = document.querySelector('.scroll-cue');
  const actMarkers = document.querySelectorAll('[data-act]');
  const progressDots = document.querySelectorAll('.progress-dot');
  const progressRail = document.querySelector('.progress-rail');
  const navEl = document.querySelector('.nav');

  let progress = 0;
  let targetProgress = 0;
  function updateProgress() {
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const scrolled = -rect.top;
    const total = rect.height - window.innerHeight;
    targetProgress = Math.max(0, Math.min(1, scrolled / total));
  }
  progressDots.forEach((d, idx) => {
    d.addEventListener('click', () => {
      const rect = stage.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const pct = idx / (progressDots.length - 1);
      const top = window.scrollY + rect.top + total * pct;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function lerpColor(a, b, t, out) {
    out.r = a.r + (b.r - a.r) * t;
    out.g = a.g + (b.g - a.g) * t;
    out.b = a.b + (b.b - a.b) * t;
    return out;
  }

  // Season tinting on grass + flowers
  let lastSeason = -1;
  function tintGrass(season) {
    if (season < 0.33) {
      grassMat.color.copy(PAL.forest300).lerp(PAL.forest500, season / 0.33);
    } else if (season < 0.66) {
      grassMat.color.copy(PAL.forest500);
    } else {
      grassMat.color.copy(PAL.forest500).lerp(PAL.autumn, (season - 0.66) / 0.34);
    }
    flowerMat.color.lerpColors(PAL.gold300, PAL.gold, Math.min(1, season * 1.5));
    canopyM.color.copy(PAL.forest500);
    canopyAlt.color.copy(PAL.forest300);
    if (season > 0.66) {
      const t2 = (season - 0.66) / 0.34;
      canopyM.color.lerp(PAL.autumn, t2 * 0.6);
      canopyAlt.color.lerp(PAL.gold, t2 * 0.5);
    }
  }

  // ============ MAIN UPDATE ============
  const tmpColor = new THREE.Color();
  let time = 0;

  // Camera path keyframes — designed for "platform" feeling
  // p=0:    Sweeping aerial — show the whole estate from above
  // p=0.25: Glide down toward the garden, see beds + mower at work
  // p=0.5:  Pan across — show pergola, pond, summerhouse, sprinklers
  // p=0.75: Ascend, scan-grid + markers light up — "platform" overlay
  // p=1.0:  Pull back high, panels float in
  const camKeys = [
    { p: 0.00, pos: [0, 28, 38], look: [0, 1, -8] },
    { p: 0.18, pos: [-8, 14, 18], look: [-2, 1, -8] },
    { p: 0.35, pos: [4, 6, 6], look: [0, 1, -6] },
    { p: 0.55, pos: [-12, 5, 2], look: [4, 1, -8] },
    { p: 0.72, pos: [10, 7, 10], look: [-2, 1, -8] },
    { p: 0.88, pos: [0, 18, 26], look: [0, 4, -6] },
    { p: 1.00, pos: [0, 14, 22], look: [0, 5, -2] },
  ];
  function sampleCam(p) {
    let i = 0;
    while (i < camKeys.length - 2 && camKeys[i + 1].p < p) i++;
    const a = camKeys[i], b = camKeys[i + 1];
    const t = (p - a.p) / (b.p - a.p);
    const e = easeInOut(Math.max(0, Math.min(1, t)));
    return {
      px: a.pos[0] + (b.pos[0] - a.pos[0]) * e,
      py: a.pos[1] + (b.pos[1] - a.pos[1]) * e,
      pz: a.pos[2] + (b.pos[2] - a.pos[2]) * e,
      lx: a.look[0] + (b.look[0] - a.look[0]) * e,
      ly: a.look[1] + (b.look[1] - a.look[1]) * e,
      lz: a.look[2] + (b.look[2] - a.look[2]) * e,
    };
  }

  function update(dt) {
    time += dt;
    progress += (targetProgress - progress) * 0.10;
    const p = progress;

    // UI fades
    if (heroIntro) heroIntro.classList.toggle('is-faded', p > 0.04);
    if (scrollCue) scrollCue.classList.toggle('is-faded', p > 0.04);
    if (progressRail) progressRail.classList.toggle('is-visible', p > 0.02 && p < 0.98);

    let activeAct = -1;
    if (p < 0.06) activeAct = -1;
    else if (p < 0.30) activeAct = 0;
    else if (p < 0.55) activeAct = 1;
    else if (p < 0.78) activeAct = 2;
    else activeAct = 3;
    actMarkers.forEach((m, idx) => m.classList.toggle('is-active', idx === activeAct));
    let activeDot = 0;
    if (p >= 0.06) activeDot = 1;
    if (p >= 0.30) activeDot = 2;
    if (p >= 0.55) activeDot = 3;
    if (p >= 0.78) activeDot = 4;
    progressDots.forEach((m, idx) => m.classList.toggle('is-active', idx === activeDot));
    if (navEl) {
      navEl.classList.toggle('on-dark', p < 0.96);
      navEl.classList.toggle('is-scrolled', window.scrollY > 30);
    }

    // === Camera ===
    const cam = sampleCam(p);
    // Subtle breathing
    const bx = Math.sin(time * 0.25) * 0.18;
    const by = Math.cos(time * 0.18) * 0.12;
    camera.position.set(cam.px + bx, cam.py + by, cam.pz);
    camera.lookAt(cam.lx, cam.ly, cam.lz);

    // === Sky ===
    let skyA, skyB, skyT;
    if (p < 0.15) { skyA = PAL.skyDawn; skyB = PAL.skyMorn; skyT = p / 0.15; }
    else if (p < 0.45) { skyA = PAL.skyMorn; skyB = PAL.skyNoon; skyT = (p - 0.15) / 0.30; }
    else if (p < 0.72) { skyA = PAL.skyNoon; skyB = PAL.skyGold; skyT = (p - 0.45) / 0.27; }
    else { skyA = PAL.skyGold; skyB = PAL.skyDusk; skyT = Math.min(1, (p - 0.72) / 0.28); }
    lerpColor(skyA, skyB, easeInOut(skyT), tmpColor);
    scene.background.copy(tmpColor);
    if (scene.fog) scene.fog.color.copy(tmpColor).lerp(PAL.forest800, 0.3);
    if (scene.fog) scene.fog.density = 0.022 - p * 0.012 + 0.003;

    // Sun
    sun.intensity = 0.7 + Math.min(1.5, p * 2);
    sun.color.lerpColors(PAL.skyMorn, new THREE.Color(0xfff0c8), Math.min(1, p * 1.6));
    if (p > 0.72) sun.color.lerp(new THREE.Color(0xffb060), (p - 0.72) / 0.28);
    hemi.intensity = 0.45 + p * 0.4;
    rayMat.opacity = Math.max(0, Math.min(0.5, (p - 0.1) * 1.5)) * (1 - Math.max(0, p - 0.85) * 4);
    sunDiscMat.opacity = Math.max(0, Math.min(0.95, p * 1.3)) * (1 - Math.max(0, p - 0.95) * 4);
    sunHaloMat.opacity = sunDiscMat.opacity * 0.6;
    const haloPulse = 1 + Math.sin(time * 0.8) * 0.04;
    sunHalo.scale.set(50 * haloPulse, 50 * haloPulse, 1);

    // Stars (only at very start)
    starMat.opacity = Math.max(0, 1 - p * 8);

    // === Grass sway (animate every-other on mobile) ===
    const step = isMobile ? 2 : 1;
    const wind = Math.sin(time * 0.6) * 0.18 + Math.sin(time * 1.3) * 0.06;
    for (let i = 0; i < Q.grass; i += step) {
      const inst = grassInst[i];
      const sway = wind * Math.sin(inst.phase + time * 0.8 + inst.x * 0.3);
      dummy.position.set(inst.x, inst.yOff, inst.z);
      dummy.rotation.set(sway * 0.3, inst.rot, sway);
      dummy.scale.set(1, inst.h, 1);
      dummy.updateMatrix();
      grass.setMatrixAt(i, dummy.matrix);
    }
    grass.instanceMatrix.needsUpdate = true;

    // Flowers bob
    for (let i = 0; i < Q.flowers; i++) {
      const inst = flowerInst[i];
      const bob = Math.sin(time * 1.2 + inst.phase) * 0.03;
      dummy.position.set(inst.x, inst.yOff + bob, inst.z);
      dummy.scale.setScalar(inst.s);
      dummy.rotation.set(0, inst.phase, 0);
      dummy.updateMatrix();
      flowers.setMatrixAt(i, dummy.matrix);
    }
    flowers.instanceMatrix.needsUpdate = true;

    // Mower glide (always visible — it's the platform's worker)
    const mt = (time * 0.4) % (Math.PI * 2);
    mower.position.x = 2 + Math.cos(mt) * 3;
    mower.position.z = -6 + Math.sin(mt * 1.3) * 2.5;
    mower.rotation.y = mt + Math.PI / 2;
    trail.position.x = mower.position.x;
    trail.position.z = mower.position.z;
    trail.rotation.z = mt;

    // Sprinklers (always running quietly; bigger when act 02-03)
    const sprP = 0.4 + Math.max(0, Math.min(1, (p - 0.25) / 0.2)) * 0.6 - Math.max(0, p - 0.78) * 1.5;
    sprMat.opacity = Math.max(0, Math.min(0.85, sprP));
    if (sprMat.opacity > 0.01) {
      const pos = sprinklers.geometry.attributes.position.array;
      const vel = sprinklers.geometry.attributes.velocity.array;
      for (let i = 0; i < totalSpr; i++) {
        pos[i * 3] += vel[i * 3];
        pos[i * 3 + 1] += vel[i * 3 + 1];
        pos[i * 3 + 2] += vel[i * 3 + 2];
        vel[i * 3 + 1] -= 0.004;
        const z = spZone[i] | 0;
        const zd = sprinklerZones[z];
        if (pos[i * 3 + 1] < 0 || Math.hypot(pos[i * 3] - zd.x, pos[i * 3 + 2] - zd.z) > 3.5) {
          pos[i * 3] = zd.x; pos[i * 3 + 1] = zd.h; pos[i * 3 + 2] = zd.z;
          const a = Math.random() * Math.PI * 2;
          const speed = 0.06 + Math.random() * 0.05;
          vel[i * 3] = Math.cos(a) * speed;
          vel[i * 3 + 1] = 0.09 + Math.random() * 0.04;
          vel[i * 3 + 2] = Math.sin(a) * speed;
        }
      }
      sprinklers.geometry.attributes.position.needsUpdate = true;
    }

    // Pollen / fireflies — pollen during day, fireflies at dusk
    const pollenP = Math.max(0, Math.min(0.5, (p - 0.1) / 0.2)) * (1 - Math.max(0, p - 0.7) * 2);
    const flyP = Math.max(0, Math.min(0.95, (p - 0.7) / 0.12));
    flyMat.opacity = Math.max(pollenP, flyP);
    flyMat.color.setHex(p > 0.7 ? 0xffe9a8 : 0xfaf2c0);
    flyMat.size = (isMobile ? 0.10 : 0.08) * (p > 0.7 ? 1 + Math.sin(time * 3.3) * 0.3 : 1);
    if (flyMat.opacity > 0.01) {
      const pos = fireflies.geometry.attributes.position.array;
      const seedA = fireflies.geometry.attributes.seed.array;
      for (let i = 0; i < flyCount; i++) {
        const sx = seedA[i * 3];
        const sy = seedA[i * 3 + 1];
        const sp = seedA[i * 3 + 2];
        pos[i * 3] += Math.sin(time * 0.4 * sp + sx) * 0.012;
        pos[i * 3 + 1] += Math.sin(time * 0.6 * sp + sy) * 0.005;
        pos[i * 3 + 2] += Math.cos(time * 0.5 * sp + sx) * 0.012;
      }
      fireflies.geometry.attributes.position.needsUpdate = true;
    }

    // Falling leaves (autumn — appear after p=0.6)
    const leafFall = Math.max(0, Math.min(1, (p - 0.6) / 0.1));
    leafMatP.opacity = leafFall * 0.85;
    if (leafMatP.opacity > 0.01) {
      const pos = fallLeaves.geometry.attributes.position.array;
      const seedA = fallLeaves.geometry.attributes.seed.array;
      for (let i = 0; i < leafCount; i++) {
        const sx = seedA[i * 3];
        const sp = seedA[i * 3 + 2];
        pos[i * 3] += Math.sin(time * 0.5 + sx + pos[i * 3 + 1]) * 0.012 * sp;
        pos[i * 3 + 1] -= 0.02 + sp * 0.008;
        pos[i * 3 + 2] += Math.cos(time * 0.4 + sx) * 0.012 * sp;
        if (pos[i * 3 + 1] < -0.2) {
          pos[i * 3 + 1] = 8 + Math.random() * 4;
          pos[i * 3] = (Math.random() - 0.5) * 50;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 50 - 6;
        }
      }
      fallLeaves.geometry.attributes.position.needsUpdate = true;
    }

    // Season tinting
    const seasonShift = Math.max(0, Math.min(1, (p - 0.4) / 0.4));
    if (Math.abs(seasonShift - lastSeason) > 0.01) {
      tintGrass(seasonShift);
      lastSeason = seasonShift;
    }

    // === Akt 04 — Scan grid + markers + floating panels ===
    const platP = Math.max(0, Math.min(1, (p - 0.78) / 0.15));
    const platE = easeOutCubic(platP);
    gridMat.opacity = platE * 0.35;
    // Grid sweeps in
    scanGrid.position.y = 0.08 + (1 - platE) * -2;
    // Markers
    markers.children.forEach((m, idx) => {
      const stagger = Math.max(0, Math.min(1, platE - idx * 0.05));
      if (m.userData.isBeam) {
        m.material.opacity = stagger * 0.3 * (0.6 + Math.sin(time * 2 + idx) * 0.4);
      } else {
        m.material.opacity = stagger * 0.85;
        const pulse = 1 + Math.sin(time * 2 + idx * 0.5) * 0.25;
        m.scale.setScalar(pulse);
      }
    });
    // Panels
    panels.forEach((pp, idx) => {
      const stagger = Math.max(0, Math.min(1, (platE - idx * 0.08) / 0.7));
      const pe = easeOutCubic(stagger);
      pp.panel.userData.bgM.opacity = pe * 0.85;
      pp.panel.userData.borderM.opacity = pe * 0.95;
      pp.panel.userData.stripM.opacity = pe;
      pp.panel.position.y = pp.pos[1] - (1 - pe) * 4;
      pp.panel.scale.setScalar(0.3 + pe * 0.7);
      // Make panels always face camera roughly on Y
      pp.panel.lookAt(camera.position.x, pp.panel.position.y, camera.position.z);
    });

    // Vignette
    let vigTarget = 0;
    if (p < 0.05) vigTarget = 0.6;
    else if (p > 0.85) vigTarget = 0.3;
    else vigTarget = 0.12;
    vignette.style.opacity = vigTarget.toFixed(2);

    renderer.render(scene, camera);
  }

  // ============ LOOP ============
  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', updateProgress, { passive: true });

  const loader = document.querySelector('.loader');
  let loaderHidden = false;
  function hideLoader() {
    if (loaderHidden || !loader) return;
    loaderHidden = true;
    loader.classList.add('is-hidden');
    setTimeout(() => loader && loader.parentNode && loader.parentNode.removeChild(loader), 900);
  }

  let last = performance.now();
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    update(dt);
    if (!stopped) requestAnimationFrame(loop);
  }

  // Return cleanup
  let stopped = false;
  function cleanup() {
    stopped = true;
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', updateProgress);
    if (vignette && vignette.parentNode) vignette.parentNode.removeChild(vignette);
  }

  if (reduced) {
    // single render at current scroll
    updateProgress();
    progress = targetProgress;
    update(0);
    hideLoader();
    window.addEventListener('scroll', () => {
      updateProgress();
      progress = targetProgress;
      update(0);
    }, { passive: true });
    return cleanup;
  } else {
    requestAnimationFrame((t) => { last = t; setTimeout(hideLoader, 400); loop(t); });
    return cleanup;
  }
}

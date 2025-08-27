// js/viewer.js
// three.js + VRM 表示、身長ベースフレーミング、Tポーズ軽減、口パク(サイン波)＋待機アニメ
// ※ setStatus 関連は全削除済み

export async function initViewer() {
  // ===== 依存モジュール（importmap 経由の動的 import）=====
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { GLTFLoader }    = await import('three/addons/loaders/GLTFLoader.js');
  const { DRACOLoader }   = await import('three/addons/loaders/DRACOLoader.js');
  const { KTX2Loader }    = await import('three/addons/loaders/KTX2Loader.js');
  const { VRMLoaderPlugin } = await import('@pixiv/three-vrm');
  const MeshoptDecoder = (await import('meshoptimizer/meshopt_decoder.module.js')).default;

  // ===== three 基本セットアップ =====
  const viewer = document.getElementById('viewer');
  const drop = document.getElementById('drop');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  viewer.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202830);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 0.35;
  controls.maxDistance = 10;

  function onResize(){
    const headerH = document.querySelector('header')?.offsetHeight ?? 0;
    const w = innerWidth, h = innerHeight - headerH;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', onResize);
  onResize();

  // ライティング
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 1.4);
  dir.position.set(0.6,1.0,0.8);
  scene.add(dir);

  // 補助光（逆側から少し弱めに）
const dir2 = new THREE.DirectionalLight(0xffffff, 0.6);
dir2.position.set(-0.6, 0.5, -0.8);
scene.add(dir2);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
hemi.position.set(0, 1, 0);
scene.add(hemi);

  // ===== ユーティリティ（身長計測・地面合わせ・フレーミング・Tポーズ軽減）=====
  function measureVRM(vrm){
    const h = vrm?.humanoid;
    const tmp = new THREE.Vector3();
    const worldY = (node)=>{ if(!node) return null; node.updateWorldMatrix?.(true,false); node.getWorldPosition(tmp); return tmp.y; };

    const headY  = worldY(h?.getNormalizedBoneNode('head')) ?? worldY(h?.getNormalizedBoneNode('neck'));
    const lFootY = worldY(h?.getNormalizedBoneNode('leftFoot'))  ?? worldY(h?.getNormalizedBoneNode('leftLowerLeg'));
    const rFootY = worldY(h?.getNormalizedBoneNode('rightFoot')) ?? worldY(h?.getNormalizedBoneNode('rightLowerLeg'));
    const feetY  = (lFootY!=null && rFootY!=null) ? Math.min(lFootY, rFootY) : (lFootY ?? rFootY ?? null);

    let minY = feetY, maxY = headY;
    if (minY == null || maxY == null) {
      const box = new THREE.Box3().setFromObject(vrm.scene);
      minY = box.min.y; maxY = box.max.y;
    }
    const height = Math.max(0.001, maxY - minY);
    const centerY = (minY + maxY) / 2;
    return { height, minY, maxY, centerY };
  }

  function normalizeGround(vrm, m){
    const dy = -m.minY; // 足元を y=0 に
    vrm.scene.position.y += dy;
    m.maxY += dy; m.centerY += dy; m.minY = 0;
    return m;
  }

  /**
   * 画面に必ず収まる距離（上下余白＋横幅考慮）で配置。
   * bias>0 で「被写体を画面の上側へ」寄せる（target を少し下げる）。
   */
  function placeCameraByHeight(vrmOrObj, metrics, {
    anchor='face', padTop=0.06, padBottom=0.06, elev=0.28, fit=0.5, bias=0.30
  } = {}) {
    const obj3d = vrmOrObj.scene ?? vrmOrObj;
    const { height, minY, maxY } = metrics;

    const showBottom = minY - height*padBottom;
    const showTop    = maxY + height*padTop;
    const showHeight = Math.max(0.001, showTop - showBottom);

    const anchors = {
      feet: showBottom,
      hips: showBottom + showHeight*0.53,
      mid:  showBottom + showHeight*0.50,
      face: showBottom + showHeight*0.90,
    };
    const targetY = anchors[anchor] ?? anchors.face;

    const box = new THREE.Box3().setFromObject(obj3d);
    const showWidth = Math.max(0.001, box.max.x - box.min.x);

    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov/2) * camera.aspect);
    const distV = (showHeight/2) / Math.tan(vFov/2);
    const distH = (showWidth /2) / Math.tan(hFov/2);
    const dist  = Math.max(distV, distH) * fit;

    const comp = -height * bias; // 上寄せ（正のbiasで target を下げる）
    controls.target.set(0, targetY + comp, 0);
    const eyeY = targetY + comp + height * elev;
    camera.position.set(0, eyeY, dist);
    controls.update();
  }

  function setRelaxedArms(vrm){
    const h = vrm?.humanoid; if (!h) return;
    const LUA = h.getNormalizedBoneNode('leftUpperArm');
    const RUA = h.getNormalizedBoneNode('rightUpperArm');
    const LLA = h.getNormalizedBoneNode('leftLowerArm');
    const RLA = h.getNormalizedBoneNode('rightLowerArm');
    if (LUA) { LUA.rotation.x = 0; LUA.rotation.z =  1.3; }
    if (RUA) { RUA.rotation.x = 0; RUA.rotation.z = -1.3; }
    if (LLA) LLA.rotation.x = -0.15;
    if (RLA) RLA.rotation.x = -0.15;
  }

  // ===== GLTF/VRM ローダ =====
  const loader = new GLTFLoader();
  loader.setDRACOLoader(new DRACOLoader().setDecoderPath('./node_modules/three/examples/jsm/libs/draco/gltf/'));
  loader.setMeshoptDecoder(MeshoptDecoder);
  const ktx2 = new KTX2Loader().setTranscoderPath('./node_modules/three/examples/jsm/libs/basis/').detectSupport(renderer);
  loader.setKTX2Loader(ktx2);
  loader.register(p => new VRMLoaderPlugin(p));

  // ===== 口パク(サイン波)＋待機アニメ =====
  let currentVRM = null;

  // 口パク
  let talking = false;
  let mouthOpenWeight = 0;
  const mouth = { phase: 0, baseHz: 4.0, energy: 0.6, boost: 0.0 };

  function setTalking(state){
    talking = !!state;
    if (!talking) { mouth.boost = 0; mouth.phase = 0; }
  }
  function onAssistantChunk(len){
    mouth.boost = Math.min(1.0, mouth.boost + Math.min(0.4, len / 120));
  }
  function updateMouth(vrm, dt){
    const em = vrm?.expressionManager; if (!em) return;
    if (talking) {
      mouth.phase += dt * (2 * Math.PI) * mouth.baseHz;
      const osc = 0.5 + 0.5 * Math.sin(mouth.phase); // 0..1
      const amp = Math.min(1.0, mouth.energy + 0.6 * mouth.boost);
      const target = Math.max(0, Math.min(1, osc * amp));
      const speed = 12.0;
      mouthOpenWeight += (target - mouthOpenWeight) * (1 - Math.exp(-speed * dt));
      mouth.boost = Math.max(0, mouth.boost - dt * 1.2);
    } else {
      const speed = 10.0;
      mouthOpenWeight += (0 - mouthOpenWeight) * (1 - Math.exp(-speed * dt));
    }
    em.setValue('aa', mouthOpenWeight);
    em.setValue?.('ih', 0); em.setValue?.('ou', 0); em.setValue?.('ee', 0); em.setValue?.('oh', 0);
  }

  // 待機アニメ（呼吸・首・腕）— 体の左右回転なし
  let bones = {};
  const idle = {
    enabled: true,
    t: 0,
    speed: { breath: 0.5, sway: 0.25, head: 0.6 },
    amp:   { breath: 0.02, swayRotY: 0.001, swayPosX: 0.001, headYaw: 0.03, headPitch: 0.02, arm: 0.08 }
  };
  function cacheBones(vrm){
    const h = vrm?.humanoid; if(!h) return;
    bones = {
      hips:  h.getNormalizedBoneNode('hips'),
      spine: h.getNormalizedBoneNode('spine'),
      chest: h.getNormalizedBoneNode('chest'),
      neck:  h.getNormalizedBoneNode('neck'),
      head:  h.getNormalizedBoneNode('head'),
      lArm:  h.getNormalizedBoneNode('leftUpperArm'),
      rArm:  h.getNormalizedBoneNode('rightUpperArm'),
    };
  }
  function captureIdleBases(){
    for (const k in bones){
      const b = bones[k]; if(!b) continue;
      b._baseRot ??= { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z };
      b._basePos ??= { x: b.position.x, y: b.position.y, z: b.position.z };
    }
  }
  function updateIdle(dt){
    if (!idle.enabled || !bones) return;
    idle.t += dt;
    const TWO_PI = Math.PI * 2;

    const breath = Math.sin(idle.t * TWO_PI * idle.speed.breath) * idle.amp.breath;
    if (bones.chest) bones.chest.rotation.x = bones.chest._baseRot.x + breath;
    if (bones.spine) bones.spine.rotation.x = bones.spine._baseRot.x + breath * 0.6;

    const sway = Math.sin(idle.t * TWO_PI * idle.speed.sway);
    if (bones.hips){
      // 体の左右回転は無効化（amp.swayRotY = 0）
      bones.hips.rotation.y = bones.hips._baseRot.y + sway * idle.amp.swayRotY;
      bones.hips.position.x = bones.hips._basePos.x + sway * idle.amp.swayPosX;
    }

    const look = Math.sin(idle.t * TWO_PI * idle.speed.head);
    if (bones.neck) bones.neck.rotation.y = bones.neck._baseRot.y + look * idle.amp.headYaw;
    if (bones.head) bones.head.rotation.x = bones.head._baseRot.x + look * idle.amp.headPitch;

    if (bones.lArm) bones.lArm.rotation.x = bones.lArm._baseRot.x + Math.sin(idle.t * TWO_PI * 0.6) * idle.amp.arm;
    if (bones.rArm) bones.rArm.rotation.x = bones.rArm._baseRot.x + Math.sin(idle.t * TWO_PI * 0.6 + Math.PI) * idle.amp.arm;
  }

  // ===== VRM 読み込み処理 =====
  function disposeCurrent(){
    if (!currentVRM) return;
    scene.remove(currentVRM.scene);
    currentVRM.dispose?.();
    currentVRM = null;
  }

  function addVRMFromGLTF(gltf){
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('userData.vrm が見つからない');

    disposeCurrent();
    currentVRM = vrm;

    vrm.scene.rotation.y = Math.PI; // 正面向き
    scene.add(vrm.scene);

    let m = measureVRM(vrm);
    m = normalizeGround(vrm, m);
    setRelaxedArms(vrm);

    // 待機アニメ：骨キャッシュ＆基準保存
    cacheBones(vrm);
    captureIdleBases();

    // デフォルトは顔寄り＋上寄せ
    placeCameraByHeight(currentVRM, m, {
      anchor:'face', padTop:0.06, padBottom:0.06, elev:0.28, fit:0.5, bias:0.30
    });
  }

  async function loadFromFile(file){
    const buf = await file.arrayBuffer();

    try{
      await new Promise((res, rej)=> loader.parse(buf,'', g=>{ addVRMFromGLTF(g); res(); }, e=>rej(e)));
      return;
    }catch(e){
      console.warn('[parse] failed, fallback to objectURL:', e);
    }

    const objectURL = URL.createObjectURL(new Blob([buf], {type:'model/gltf-binary'}));
    try{
      await new Promise((res, rej)=> loader.load(objectURL, g=>{ addVRMFromGLTF(g); res(); }, undefined, e=>rej(e)));
    } finally {
      URL.revokeObjectURL(objectURL);
    }
  }

  // ===== UI: ファイル選択 / DnD / リセット =====
  document.getElementById('file').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    try{ await loadFromFile(f); } finally { e.target.value=''; }
  });

  addEventListener('dragover', (e)=>{ e.preventDefault(); drop.classList.add('active'); });
  addEventListener('dragleave', (e)=>{ e.preventDefault(); drop.classList.remove('active'); });
  addEventListener('drop', async (e)=>{
    e.preventDefault(); drop.classList.remove('active');
    const f = e.dataTransfer?.files?.[0];
    if(!f) return;
    await loadFromFile(f);
  });

  // 設定パネルの連動（存在すれば動く）
  const idleToggle = document.getElementById('idleToggle');
  if (idleToggle) idleToggle.addEventListener('change', (e)=>{ idle.enabled = e.target.checked; });

  const mouthToggle = document.getElementById('mouthToggle');
  if (mouthToggle) mouthToggle.addEventListener('change', (e)=>{ if (!e.target.checked) talking = false; });

  const resetCam = document.getElementById('resetCam');
  if (resetCam) resetCam.addEventListener('click', ()=>{
    if (!currentVRM) return;
    const m = measureVRM(currentVRM);
    placeCameraByHeight(currentVRM, m, { anchor:'face', padTop:0.06, padBottom:0.06, elev:0.28, fit:0.5, bias:0.30 });
  });

  // ===== ループ =====
  const clock = new THREE.Clock();
  (function tick(){
    const dt = clock.getDelta();
    if (currentVRM) {
      currentVRM.update(dt);
      updateMouth(currentVRM, dt); // 口パク
      updateIdle(dt);              // 待機アニメ
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  })();

  // chat.js から利用するAPI
  return {
    setTalking,
    onAssistantChunk,
    getVRM(){ return currentVRM; }
  };
}

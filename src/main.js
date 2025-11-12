import * as THREE from 'three';
import './style.css';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 0, 0.4);

const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const light = new THREE.PointLight(0xffffff, 50);
light.position.set(20, 20, 20);

scene.add(light);
renderer.outputColorSpace = THREE.SRGBColorSpace; // r152+

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 10);
dir.position.set(10, 20, 10);
dir.castShadow = true;
scene.add(dir);

scene.add(new THREE.AmbientLight(0xffffff, 50));


// addEventListener('resize', () => {
//     camera.aspect = innerWidth / innerHeight;
//     camera.updateProjectionMatrix();
//     renderer.setSize(innerWidth, innerHeight);
//     renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// });

let model;
const loader = new GLTFLoader();

loader.load('/public/mirror.glb', (gltf) => {
    model = gltf.scene;
    scene.add(model);
    controls.enableZoom = false;
    prepareExplodedView(model);
}, undefined, (error) => console.error(error));

let parts = [];           // { obj, origWorld: Vector3, dir: Vector3 }
let explosion = 0;        
let targetExplosion = 0; 
let maxDistance = 1;    

function prepareExplodedView(root) {
    root.updateWorldMatrix(true, true);
    const bbox = new THREE.Box3().setFromObject(root);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    maxDistance = size.length() * 0.4;

    parts = [];
    root.traverse((obj) => {
        if (!obj.isMesh || obj.isSkinnedMesh) return;
        const wp = new THREE.Vector3();
        obj.getWorldPosition(wp);
        const dir = new THREE.Vector3().subVectors(wp, center);
        if (dir.lengthSq() === 0) {
            dir.set(0, 1, 0);
        } else {
            dir.normalize();
        }

        parts.push({ obj, origWorld: wp.clone(), dir });
    });

    setExplosion(0, true);
}

function setExplosion(f, snap = false) {
    targetExplosion = THREE.MathUtils.clamp(f, 0, 1);
    if (snap) explosion = targetExplosion; 
}

function updateExplosion(dt) {
    const speed = 4; 
    explosion += (targetExplosion - explosion) * Math.min(1, speed * dt);

    for (const p of parts) {
        const targetWorld = p.origWorld.clone().addScaledVector(p.dir, maxDistance * explosion);
        const targetLocal = p.obj.parent.worldToLocal(targetWorld);
        p.obj.position.copy(targetLocal);
    }
}

window.addEventListener('wheel', (e) => {
    const step = 0.08;
    setExplosion(targetExplosion + (e.deltaY < 0 ? step : -step));
}, { passive: true });

window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'e') setExplosion(1);
    if (e.key.toLowerCase() === 'r') setExplosion(0);
});

let last = performance.now();
function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;

    controls.update();
    if (parts.length) updateExplosion(dt);

    renderer.render(scene, camera);
}
animate();


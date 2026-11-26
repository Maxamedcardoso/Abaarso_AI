import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(ROOT, 'android-app');
const BUILD_DIR = path.join(ANDROID_DIR, 'build');
const RES_DIR = path.join(ANDROID_DIR, 'res');
const SRC_DIR = path.join(ANDROID_DIR, 'src');
const KEYSTORE_DIR = path.join(ANDROID_DIR, 'keystore');
const OUT_APK_DIR = path.join(ROOT, 'assets', 'apk');
const OUT_APK_PATH = path.join(OUT_APK_DIR, 'CARDOSO-AI.apk');

// Locate Android SDK
const sdkRoot =
  process.env.ANDROID_SDK_ROOT ||
  process.env.ANDROID_HOME ||
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');

if (!fs.existsSync(sdkRoot)) {
  throw new Error(`Android SDK not found at: ${sdkRoot}`);
}

const pickHighestVersionDir = (parentDir, filterPrefix = '') => {
  const entries = fs
    .readdirSync(parentDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(filterPrefix) && !d.name.includes('-rc'))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!entries.length) {
    throw new Error(`No matching directories found in ${parentDir}`);
  }
  return path.join(parentDir, entries[entries.length - 1]);
};

const platformDir = fs.existsSync(path.join(sdkRoot, 'platforms', 'android-34'))
  ? path.join(sdkRoot, 'platforms', 'android-34')
  : pickHighestVersionDir(path.join(sdkRoot, 'platforms'), 'android-');
const androidJar = path.join(platformDir, 'android.jar');
const buildToolsDir = fs.existsSync(path.join(sdkRoot, 'build-tools', '35.0.0'))
  ? path.join(sdkRoot, 'build-tools', '35.0.0')
  : pickHighestVersionDir(path.join(sdkRoot, 'build-tools'));

const isWin = process.platform === 'win32';
const aapt2 = path.join(buildToolsDir, isWin ? 'aapt2.exe' : 'aapt2');
const d8 = path.join(buildToolsDir, isWin ? 'd8.bat' : 'd8');
const zipalign = path.join(buildToolsDir, isWin ? 'zipalign.exe' : 'zipalign');
const apksigner = path.join(buildToolsDir, isWin ? 'apksigner.bat' : 'apksigner');

function runTool(exe, args) {
  const needsShell = isWin && exe.toLowerCase().endsWith('.bat');
  console.log(`▶ ${path.basename(exe)} ${args.slice(0, 4).join(' ')}...`);
  execFileSync(exe, args, {
    cwd: ANDROID_DIR,
    stdio: 'inherit',
    shell: needsShell,
  });
}

async function generateLauncherIcons() {
  // Reuse our compiled pure-Node CARDOSO AI anti-aliased PNG icon generator!
  const pwaModPath = path.join(ROOT, 'dist', 'web', 'pwa-assets.js');
  if (!fs.existsSync(pwaModPath)) {
    throw new Error('Please run `npm run build` first so dist/web/pwa-assets.js exists.');
  }
  const { getAppIconPng } = await import(`file:///${pwaModPath.replace(/\\/g, '/')}`);
  const densities = [
    { dir: 'mipmap-mdpi', size: 64 },
    { dir: 'mipmap-hdpi', size: 72 },
    { dir: 'mipmap-xhdpi', size: 96 },
    { dir: 'mipmap-xxhdpi', size: 144 },
    { dir: 'mipmap-xxxhdpi', size: 192 },
  ];
  for (const d of densities) {
    const targetDir = path.join(RES_DIR, d.dir);
    fs.mkdirSync(targetDir, { recursive: true });
    const pngBuf = getAppIconPng(d.size, false);
    fs.writeFileSync(path.join(targetDir, 'ic_launcher.png'), pngBuf);
  }
  console.log('✅ Generated branded CARDOSO AI launcher icons (mdpi -> xxxhdpi)');
}

async function main() {
  console.log(`\n📱 Building CARDOSO-AI.apk`);
  console.log(`   SDK Platform: ${path.basename(platformDir)}`);
  console.log(`   Build Tools:  ${path.basename(buildToolsDir)}\n`);

  await generateLauncherIcons();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  const compiledResDir = path.join(BUILD_DIR, 'compiled_res');
  const genSrcDir = path.join(BUILD_DIR, 'gen');
  const classesDir = path.join(BUILD_DIR, 'classes');
  const dexDir = path.join(BUILD_DIR, 'dex');
  fs.mkdirSync(compiledResDir, { recursive: true });
  fs.mkdirSync(genSrcDir, { recursive: true });
  fs.mkdirSync(classesDir, { recursive: true });
  fs.mkdirSync(dexDir, { recursive: true });

  // 1. Compile all Android resources with aapt2
  const resFlatZip = path.join(BUILD_DIR, 'res.zip');
  runTool(aapt2, ['compile', '--dir', RES_DIR, '-o', resFlatZip]);

  // 2. Link resources + AndroidManifest.xml -> base APK + R.java
  const baseApk = path.join(BUILD_DIR, 'base.apk');
  runTool(aapt2, [
    'link',
    '-I', androidJar,
    '--manifest', path.join(ANDROID_DIR, 'AndroidManifest.xml'),
    '--java', genSrcDir,
    '-o', baseApk,
    resFlatZip,
  ]);

  // 3. Compile Java sources (targeting Java 8 bytecode for Android 5.0+ compatibility)
  const rJavaPath = path.join(genSrcDir, 'com', 'cardoso', 'ai', 'R.java');
  const mainJavaPath = path.join(SRC_DIR, 'com', 'cardoso', 'ai', 'MainActivity.java');
  runTool(isWin ? 'javac.exe' : 'javac', [
    '--release', '8',
    '-classpath', androidJar,
    '-d', classesDir,
    rJavaPath,
    mainJavaPath,
  ]);

  // 4. Convert .class files -> classes.dex using d8
  const classFiles = [];
  const collectClasses = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) collectClasses(full);
      else if (ent.name.endsWith('.class')) classFiles.push(full);
    }
  };
  collectClasses(classesDir);

  runTool(d8, [
    '--release',
    '--min-api', '21',
    '--lib', androidJar,
    '--output', dexDir,
    ...classFiles,
  ]);

  // 5. Add classes.dex into base.apk using jar (from JDK)
  const unsignedApk = path.join(BUILD_DIR, 'unsigned.apk');
  fs.copyFileSync(baseApk, unsignedApk);
  runTool(isWin ? 'jar.exe' : 'jar', ['uf', unsignedApk, '-C', dexDir, 'classes.dex']);

  // 6. Zipalign APK on 4-byte boundary
  const alignedApk = path.join(BUILD_DIR, 'aligned.apk');
  runTool(zipalign, ['-f', '-p', '4', unsignedApk, alignedApk]);

  // 7. Create release keystore if missing & sign with apksigner (V1 + V2 + V3)
  fs.mkdirSync(KEYSTORE_DIR, { recursive: true });
  const keystorePath = path.join(KEYSTORE_DIR, 'cardoso-release.jks');
  const storePass = process.env.CARDOSO_APK_STOREPASS || 'cardoso2026release';
  const keyAlias = 'cardoso_ai';
  if (!fs.existsSync(keystorePath)) {
    runTool(isWin ? 'keytool.exe' : 'keytool', [
      '-genkeypair',
      '-v',
      '-keystore', keystorePath,
      '-alias', keyAlias,
      '-keyalg', 'RSA',
      '-keysize', '2048',
      '-validity', '10000',
      '-storepass', storePass,
      '-keypass', storePass,
      '-dname', 'CN=CARDOSO AI, OU=Mobile, O=CARDOSO, L=Hargeysa, C=SO',
    ]);
  }

  fs.mkdirSync(OUT_APK_DIR, { recursive: true });
  runTool(apksigner, [
    'sign',
    '--ks', keystorePath,
    '--ks-key-alias', keyAlias,
    '--ks-pass', `pass:${storePass}`,
    '--key-pass', `pass:${storePass}`,
    '--v1-signing-enabled', 'true',
    '--v2-signing-enabled', 'true',
    '--v3-signing-enabled', 'true',
    '--out', OUT_APK_PATH,
    alignedApk,
  ]);

  // 8. Verify APK signature cleanly
  runTool(apksigner, ['verify', '--print-certs', OUT_APK_PATH]);

  const stat = fs.statSync(OUT_APK_PATH);
  console.log(`\n🎉 SUCCESS! Signed APK created:`);
  console.log(`   Path: ${OUT_APK_PATH}`);
  console.log(`   Size: ${(stat.size / 1024).toFixed(1)} KB\n`);
}

main().catch((err) => {
  console.error('❌ APK build failed:', err);
  process.exit(1);
});

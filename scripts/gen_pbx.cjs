// Node port of scripts/gen_pbx.py — byte-identical output (LF endings).
// Usage: node scripts/gen_pbx.js [--check]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJ_DIR = path.join('ios', 'Yooh');
const APP_DIR = path.join(PROJ_DIR, 'Yooh');
const TESTS_DIR = path.join(PROJ_DIR, 'YoohTests');
const OUT = path.join(PROJ_DIR, 'Yooh.xcodeproj', 'project.pbxproj');

const NAMESPACE_URL = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
function uid(name) {
  const h = crypto.createHash('sha1');
  h.update(NAMESPACE_URL);
  h.update(Buffer.from('yooh://' + name, 'utf8'));
  const d = Buffer.from(h.digest());
  d[6] = (d[6] & 0x0f) | 0x50; // version 5
  d[8] = (d[8] & 0x3f) | 0x80; // variant RFC4122
  return d.slice(0, 16).toString('hex').toUpperCase().slice(0, 24);
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function collect() {
  const swift = [];
  for (const full of walk(APP_DIR)) {
    const rel = path.relative(PROJ_DIR, full).split(path.sep).join('/');
    const base = path.basename(full);
    if (base.endsWith('.swift')) swift.push(rel);
  }
  const tests = [];
  for (const f of fs.readdirSync(TESTS_DIR).sort()) {
    if (f.endsWith('.swift')) tests.push('YoohTests/' + f);
  }
  return [swift.sort(), tests.sort()];
}

const [SWIFT, TESTS] = collect();
console.log(`swift files: ${SWIFT.length}, test files: ${TESTS.length}`);

const GROUPS = {};
function ensureGroup(p) {
  if (!GROUPS[p]) GROUPS[p] = { sub: [], files: [] };
  return GROUPS[p];
}
for (const rel of SWIFT) {
  const parts = rel.split('/');
  const folder = parts.slice(0, -1).join('/');
  ensureGroup(folder).files.push(rel);
}
ensureGroup('YoohTests').files.push(...TESTS);
for (const folder of Object.keys(GROUPS)) {
  if (folder.includes('/')) {
    const parent = folder.slice(0, folder.lastIndexOf('/'));
    ensureGroup(parent);
    if (!GROUPS[parent].sub.includes(folder)) GROUPS[parent].sub.push(folder);
  }
}

const L = [];
const A = s => L.push(s);
function fileref(rel, ftype, name) {
  A(`\t\t${uid('ref:' + rel)} = {isa = PBXFileReference; lastKnownFileType = ${ftype}; name = ${name || rel.split('/').pop()}; path = ${rel}; sourceTree = "<group>"; };`);
}

A('// !$*UTF8*$!');
A('{');
A('\tarchiveVersion = 1;');
A('\tclasses = {');
A('\t};');
A('\tobjectVersion = 56;');
A('\tobjects = {');

for (const rel of SWIFT) fileref(rel, 'sourcecode.swift');
for (const rel of TESTS) fileref(rel, 'sourcecode.swift');
fileref('Yooh/Info.plist', 'text.plist.xml');
fileref('Yooh/Assets.xcassets', 'folder.assetcatalog', 'Assets.xcassets');

const APP_PROD = uid('product:Yooh.app');
const TEST_PROD = uid('product:YoohTests.xctest');
A(`\t\t${APP_PROD} = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Yooh.app; sourceTree = BUILT_PRODUCTS_DIR; };`);
A(`\t\t${TEST_PROD} = {isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = YoohTests.xctest; sourceTree = BUILT_PRODUCTS_DIR; };`);

for (const rel of SWIFT) A(`\t\t${uid('build:' + rel)} = {isa = PBXBuildFile; fileRef = ${uid('ref:' + rel)}; };`);
A(`\t\t${uid('build:Yooh/Assets.xcassets')} = {isa = PBXBuildFile; fileRef = ${uid('ref:Yooh/Assets.xcassets')}; };`);
for (const rel of TESTS) A(`\t\t${uid('build:' + rel)} = {isa = PBXBuildFile; fileRef = ${uid('ref:' + rel)}; };`);

const PRODUCTS_GROUP = uid('group:Products');
for (const folder of Object.keys(GROUPS).sort()) {
  const name = folder.split('/').pop();
  const kids = [];
  for (const sub of [...GROUPS[folder].sub].sort()) kids.push(uid('group:' + sub));
  for (const f of [...GROUPS[folder].files].sort()) kids.push(uid('ref:' + f));
  if (folder === 'Yooh') {
    kids.push(uid('ref:Yooh/Info.plist'));
    kids.push(uid('ref:Yooh/Assets.xcassets'));
  }
  A(`\t\t${uid('group:' + folder)} = {isa = PBXGroup; children = (${kids.join(', ')}); name = ${name}; sourceTree = "<group>"; };`);
}

const MAIN_GROUP = uid('group:main');
A(`\t\t${MAIN_GROUP} = {isa = PBXGroup; children = (${uid('group:Yooh')}, ${uid('group:YoohTests')}, ${PRODUCTS_GROUP}); sourceTree = "<group>"; };`);
A(`\t\t${PRODUCTS_GROUP} = {isa = PBXGroup; children = (${APP_PROD}, ${TEST_PROD}); name = Products; sourceTree = "<group>"; };`);

const APP_SRC = uid('phase:Yooh:sources');
const APP_RES = uid('phase:Yooh:resources');
const APP_FW = uid('phase:Yooh:frameworks');
const TEST_SRC = uid('phase:YoohTests:sources');
const TEST_FW = uid('phase:YoohTests:frameworks');

A(`\t\t${APP_FW} = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };`);
A(`\t\t${APP_SRC} = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (${SWIFT.map(r => uid('build:' + r)).join(', ')}); runOnlyForDeploymentPostprocessing = 0; };`);
A(`\t\t${APP_RES} = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (${uid('build:Yooh/Assets.xcassets')}); runOnlyForDeploymentPostprocessing = 0; };`);
A(`\t\t${TEST_FW} = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };`);
A(`\t\t${TEST_SRC} = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (${TESTS.map(r => uid('build:' + r)).join(', ')}); runOnlyForDeploymentPostprocessing = 0; };`);

const APP_TARGET = uid('target:Yooh');
const TEST_TARGET = uid('target:YoohTests');
const APP_CFG_LIST = uid('cfglist:Yooh');
const TEST_CFG_LIST = uid('cfglist:YoohTests');
const PROXY = uid('proxy:tests->app');
const DEP = uid('dep:tests->app');

A(`\t\t${PROXY} = {isa = PBXContainerItemProxy; containerPortal = ${uid('project')}; proxyType = 1; remoteGlobalIDString = ${APP_TARGET}; remoteInfo = Yooh; };`);
A(`\t\t${DEP} = {isa = PBXTargetDependency; targetProxy = ${PROXY}; };`);
A(`\t\t${APP_TARGET} = {isa = PBXNativeTarget; buildConfigurationList = ${APP_CFG_LIST}; buildPhases = (${APP_SRC}, ${APP_FW}, ${APP_RES}); buildRules = (); dependencies = (); name = Yooh; productName = Yooh; productReference = ${APP_PROD}; productType = "com.apple.product-type.application"; };`);
A(`\t\t${TEST_TARGET} = {isa = PBXNativeTarget; buildConfigurationList = ${TEST_CFG_LIST}; buildPhases = (${TEST_SRC}, ${TEST_FW}); buildRules = (); dependencies = (${DEP}); name = YoohTests; productName = YoohTests; productReference = ${TEST_PROD}; productType = "com.apple.product-type.bundle.unit-test"; };`);

function cfg(name, settings) {
  const lines = [`\t\t${uid('cfg:' + name)} = {isa = XCBuildConfiguration; buildSettings = {`];
  for (const [k, v] of Object.entries(settings)) lines.push(`\t\t\t${k} = ${v};`);
  lines.push('\t\t};');
  lines.push(`\t\tname = ${name.split(':').pop()};`);
  lines.push('\t\t};');
  A(lines.join('\n'));
}

const APP_COMMON = {
  ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
  ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: 'AccentColor',
  CODE_SIGN_STYLE: 'Automatic',
  CURRENT_PROJECT_VERSION: '1',
  GENERATE_INFOPLIST_FILE: 'NO',
  INFOPLIST_FILE: 'Yooh/Info.plist',
  INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents: 'YES',
  IPHONEOS_DEPLOYMENT_TARGET: '17.0',
  LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks"',
  MARKETING_VERSION: '1.0',
  PRODUCT_BUNDLE_IDENTIFIER: 'com.yooh.app',
  PRODUCT_NAME: '"$(TARGET_NAME)"',
  SDKROOT: 'iphoneos',
  SWIFT_EMIT_LOC_STRINGS: 'NO',
  SWIFT_VERSION: '5.0',
  TARGETED_DEVICE_FAMILY: '1',
};
const TEST_COMMON = {
  BUNDLE_LOADER: '"$(TEST_HOST)"',
  CODE_SIGN_STYLE: 'Automatic',
  CURRENT_PROJECT_VERSION: '1',
  GENERATE_INFOPLIST_FILE: 'YES',
  IPHONEOS_DEPLOYMENT_TARGET: '17.0',
  MARKETING_VERSION: '1.0',
  PRODUCT_BUNDLE_IDENTIFIER: 'com.yooh.app.tests',
  PRODUCT_NAME: '"$(TARGET_NAME)"',
  SDKROOT: 'iphoneos',
  SWIFT_EMIT_LOC_STRINGS: 'NO',
  SWIFT_VERSION: '5.0',
  TARGETED_DEVICE_FAMILY: '1',
  TEST_HOST: '"$(BUILT_PRODUCTS_DIR)/Yooh.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Yooh"',
};
cfg('proj:Debug', { ALWAYS_SEARCH_USER_PATHS: 'NO', MARKETING_VERSION: '1.0' });
cfg('proj:Release', { ALWAYS_SEARCH_USER_PATHS: 'NO', MARKETING_VERSION: '1.0' });
cfg('app:Debug', APP_COMMON);
cfg('app:Release', APP_COMMON);
cfg('tests:Debug', TEST_COMMON);
cfg('tests:Release', TEST_COMMON);

const PROJ_CFG_LIST = uid('cfglist:proj');
A(`\t\t${PROJ_CFG_LIST} = {isa = XCConfigurationList; buildConfigurations = (${uid('cfg:proj:Debug')}, ${uid('cfg:proj:Release')}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };`);
A(`\t\t${APP_CFG_LIST} = {isa = XCConfigurationList; buildConfigurations = (${uid('cfg:app:Debug')}, ${uid('cfg:app:Release')}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };`);
A(`\t\t${TEST_CFG_LIST} = {isa = XCConfigurationList; buildConfigurations = (${uid('cfg:tests:Debug')}, ${uid('cfg:tests:Release')}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };`);

const PROJECT = uid('project');
A(`\t\t${PROJECT} = {isa = PBXProject; attributes = {BuildIndependentTargetsInParallel = 1; LastUpgradeCheck = 1600; TargetAttributes = {${APP_TARGET} = {CreatedOnToolsVersion = 16.0;}; ${TEST_TARGET} = {CreatedOnToolsVersion = 16.0;};};}; buildConfigurationList = ${PROJ_CFG_LIST}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base); mainGroup = ${MAIN_GROUP}; productRefGroup = ${PRODUCTS_GROUP}; projectDirPath = ""; projectRoot = ""; targets = (${APP_TARGET}, ${TEST_TARGET}); };`);

A('\t};');
A(`\trootObject = ${PROJECT};`);
A('}');

const text = L.join('\n') + '\n';
if (process.argv.includes('--check')) {
  const cur = fs.readFileSync(OUT, 'utf8');
  if (cur === text) { console.log('pbxproj in sync'); process.exit(0); }
  console.log('pbxproj OUT OF SYNC');
  process.exit(1);
} else {
  fs.writeFileSync(OUT, text);
  console.log('wrote', OUT);
}

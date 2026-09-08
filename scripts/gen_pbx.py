"""Generates ios/Yooh/Yooh.xcodeproj/project.pbxproj by scanning the tree.

Single app target (Yooh, iOS 17, Swift 5, iPhone) + unit-test target.
Deterministic UUIDs so regeneration is diff-stable. Re-run after adding files.
"""
import os
import uuid

PROJ_DIR = os.path.join(
    r"C:\Users\enoti\OneDrive", "Рабочий стол", "Мои проекты", "Yooh_V2",
    "ios", "Yooh",
)
APP_DIR = os.path.join(PROJ_DIR, "Yooh")
TESTS_DIR = os.path.join(PROJ_DIR, "YoohTests")
OUT = os.path.join(PROJ_DIR, "Yooh.xcodeproj", "project.pbxproj")


def uid(name):
    return uuid.uuid5(uuid.NAMESPACE_URL, "yooh://" + name).hex.upper()[:24]


def collect():
    swift, resources = [], []
    for dp, _, fns in os.walk(APP_DIR):
        for f in sorted(fns):
            full = os.path.join(dp, f)
            rel = os.path.relpath(full, PROJ_DIR).replace(os.sep, "/")
            if f.endswith(".swift"):
                swift.append(rel)
            elif f == "Contents.json" or f.endswith(".png"):
                resources.append(rel)  # inside .xcassets, referenced via the catalog
    tests = []
    for f in sorted(os.listdir(TESTS_DIR)):
        if f.endswith(".swift"):
            tests.append("YoohTests/" + f)
    return sorted(swift), sorted(tests)


SWIFT, TESTS = collect()
print(f"swift files: {len(SWIFT)}, test files: {len(TESTS)}")

# Groups: folder path -> children ( subgroups + files )
GROUPS = {}

def ensure_group(path):
    if path not in GROUPS:
        GROUPS[path] = {"sub": [], "files": []}
    return GROUPS[path]

for rel in SWIFT:
    parts = rel.split("/")
    folder = "/".join(parts[:-1])
    ensure_group(folder)["files"].append(rel)
ensure_group("YoohTests")["files"].extend(TESTS)

# Parent links
for folder in list(GROUPS):
    if "/" in folder:
        parent = folder.rsplit("/", 1)[0]
        ensure_group(parent)
        if folder not in GROUPS[parent]["sub"]:
            GROUPS[parent]["sub"].append(folder)

L = []
A = L.append


def fileref(rel, ftype, name=None):
    A(f"\t\t{uid('ref:' + rel)} = {{isa = PBXFileReference; lastKnownFileType = {ftype}; name = {name or rel.split('/')[-1]}; path = {rel}; sourceTree = \"<group>\"; }};")


A("// !$*UTF8*$!")
A("{")
A("\tarchiveVersion = 1;")
A("\tclasses = {")
A("\t};")
A("\tobjectVersion = 56;")
A("\tobjects = {")

# ---- File references ----
for rel in SWIFT:
    fileref(rel, "sourcecode.swift")
for rel in TESTS:
    fileref(rel, "sourcecode.swift")
fileref("Yooh/Info.plist", "text.plist.xml")
fileref("Yooh/Assets.xcassets", "folder.assetcatalog", "Assets.xcassets")

APP_PROD = uid("product:Yooh.app")
TEST_PROD = uid("product:YoohTests.xctest")
A(f"\t\t{APP_PROD} = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Yooh.app; sourceTree = BUILT_PRODUCTS_DIR; }};")
A(f"\t\t{TEST_PROD} = {{isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = YoohTests.xctest; sourceTree = BUILT_PRODUCTS_DIR; }};")

# ---- Build files ----
for rel in SWIFT:
    A(f"\t\t{uid('build:' + rel)} = {{isa = PBXBuildFile; fileRef = {uid('ref:' + rel)}; }};")
A(f"\t\t{uid('build:Yooh/Assets.xcassets')} = {{isa = PBXBuildFile; fileRef = {uid('ref:Yooh/Assets.xcassets')}; }};")
for rel in TESTS:
    A(f"\t\t{uid('build:' + rel)} = {{isa = PBXBuildFile; fileRef = {uid('ref:' + rel)}; }};")

# ---- Groups ----
PRODUCTS_GROUP = uid("group:Products")
for folder in sorted(GROUPS):
    name = folder.split("/")[-1]
    kids = []
    for sub in sorted(GROUPS[folder]["sub"]):
        kids.append(uid("group:" + sub))
    for f in sorted(GROUPS[folder]["files"]):
        kids.append(uid("ref:" + f))
    if folder == "Yooh":
        kids.append(uid("ref:Yooh/Info.plist"))
        kids.append(uid("ref:Yooh/Assets.xcassets"))
    kids_str = ", ".join(kids)
    A(f"\t\t{uid('group:' + folder)} = {{isa = PBXGroup; children = ({kids_str}); name = {name}; sourceTree = \"<group>\"; }};")

MAIN_GROUP = uid("group:main")
A(f"\t\t{MAIN_GROUP} = {{isa = PBXGroup; children = ({uid('group:Yooh')}, {uid('group:YoohTests')}, {PRODUCTS_GROUP}); sourceTree = \"<group>\"; }};")
A(f"\t\t{PRODUCTS_GROUP} = {{isa = PBXGroup; children = ({APP_PROD}, {TEST_PROD}); name = Products; sourceTree = \"<group>\"; }};")

# ---- Phases ----
APP_SRC = uid("phase:Yooh:sources")
APP_RES = uid("phase:Yooh:resources")
APP_FW = uid("phase:Yooh:frameworks")
TEST_SRC = uid("phase:YoohTests:sources")
TEST_FW = uid("phase:YoohTests:frameworks")

A(f"\t\t{APP_FW} = {{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; }};")
src_files = ", ".join(uid("build:" + r) for r in SWIFT)
A(f"\t\t{APP_SRC} = {{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({src_files}); runOnlyForDeploymentPostprocessing = 0; }};")
A(f"\t\t{APP_RES} = {{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({uid('build:Yooh/Assets.xcassets')}); runOnlyForDeploymentPostprocessing = 0; }};")
A(f"\t\t{TEST_FW} = {{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; }};")
test_files = ", ".join(uid("build:" + r) for r in TESTS)
A(f"\t\t{TEST_SRC} = {{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({test_files}); runOnlyForDeploymentPostprocessing = 0; }};")

# ---- Targets ----
APP_TARGET = uid("target:Yooh")
TEST_TARGET = uid("target:YoohTests")
APP_CFG_LIST = uid("cfglist:Yooh")
TEST_CFG_LIST = uid("cfglist:YoohTests")
PROXY = uid("proxy:tests->app")
DEP = uid("dep:tests->app")

A(f"\t\t{PROXY} = {{isa = PBXContainerItemProxy; containerPortal = {uid('project')}; proxyType = 1; remoteGlobalIDString = {APP_TARGET}; remoteInfo = Yooh; }};")
A(f"\t\t{DEP} = {{isa = PBXTargetDependency; targetProxy = {PROXY}; }};")
A(f"\t\t{APP_TARGET} = {{isa = PBXNativeTarget; buildConfigurationList = {APP_CFG_LIST}; buildPhases = ({APP_SRC}, {APP_FW}, {APP_RES}); buildRules = (); dependencies = (); name = Yooh; productName = Yooh; productReference = {APP_PROD}; productType = \"com.apple.product-type.application\"; }};")
A(f"\t\t{TEST_TARGET} = {{isa = PBXNativeTarget; buildConfigurationList = {TEST_CFG_LIST}; buildPhases = ({TEST_SRC}, {TEST_FW}); buildRules = (); dependencies = ({DEP}); name = YoohTests; productName = YoohTests; productReference = {TEST_PROD}; productType = \"com.apple.product-type.bundle.unit-test\"; }};")


def cfg(name, settings):
    lines = [f"\t\t{uid('cfg:' + name)} = {{isa = XCBuildConfiguration; buildSettings = {{"]
    for k, v in settings.items():
        lines.append(f"\t\t\t{k} = {v};")
    lines.append("\t\t};")
    lines.append(f"\t\tname = {name.split(':')[-1]};")
    lines.append("\t\t};")
    A("\n".join(lines))


APP_COMMON = {
    "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
    "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "1",
    "GENERATE_INFOPLIST_FILE": "NO",
    "INFOPLIST_FILE": "Yooh/Info.plist",
    "INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents": "YES",
    "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
    "LD_RUNPATH_SEARCH_PATHS": '"$(inherited) @executable_path/Frameworks"',
    "MARKETING_VERSION": "1.0",
    "PRODUCT_BUNDLE_IDENTIFIER": "com.yooh.app",
    "PRODUCT_NAME": '"$(TARGET_NAME)"',
    "SDKROOT": "iphoneos",
    "SWIFT_EMIT_LOC_STRINGS": "NO",
    "SWIFT_VERSION": "5.0",
    "TARGETED_DEVICE_FAMILY": "1",
}
TEST_COMMON = {
    "BUNDLE_LOADER": '"$(TEST_HOST)"',
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "1",
    "GENERATE_INFOPLIST_FILE": "YES",
    "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
    "MARKETING_VERSION": "1.0",
    "PRODUCT_BUNDLE_IDENTIFIER": "com.yooh.app.tests",
    "PRODUCT_NAME": '"$(TARGET_NAME)"',
    "SDKROOT": "iphoneos",
    "SWIFT_EMIT_LOC_STRINGS": "NO",
    "SWIFT_VERSION": "5.0",
    "TARGETED_DEVICE_FAMILY": "1",
    "TEST_HOST": '"$(BUILT_PRODUCTS_DIR)/Yooh.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Yooh"',
}

cfg("proj:Debug", {"ALWAYS_SEARCH_USER_PATHS": "NO", "MARKETING_VERSION": "1.0"})
cfg("proj:Release", {"ALWAYS_SEARCH_USER_PATHS": "NO", "MARKETING_VERSION": "1.0"})
cfg("app:Debug", APP_COMMON)
cfg("app:Release", APP_COMMON)
cfg("tests:Debug", TEST_COMMON)
cfg("tests:Release", TEST_COMMON)

PROJ_CFG_LIST = uid("cfglist:proj")
A(f"\t\t{PROJ_CFG_LIST} = {{isa = XCConfigurationList; buildConfigurations = ({uid('cfg:proj:Debug')}, {uid('cfg:proj:Release')}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};")
A(f"\t\t{APP_CFG_LIST} = {{isa = XCConfigurationList; buildConfigurations = ({uid('cfg:app:Debug')}, {uid('cfg:app:Release')}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};")
A(f"\t\t{TEST_CFG_LIST} = {{isa = XCConfigurationList; buildConfigurations = ({uid('cfg:tests:Debug')}, {uid('cfg:tests:Release')}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};")

# ---- Project ----
PROJECT = uid("project")
A(f"\t\t{PROJECT} = {{isa = PBXProject; attributes = {{BuildIndependentTargetsInParallel = 1; LastUpgradeCheck = 1600; TargetAttributes = {{{APP_TARGET} = {{CreatedOnToolsVersion = 16.0;}}; {TEST_TARGET} = {{CreatedOnToolsVersion = 16.0;}};}};}}; buildConfigurationList = {PROJ_CFG_LIST}; compatibilityVersion = \"Xcode 14.0\"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base); mainGroup = {MAIN_GROUP}; productRefGroup = {PRODUCTS_GROUP}; projectDirPath = \"\"; projectRoot = \"\"; targets = ({APP_TARGET}, {TEST_TARGET}); }};")

A("\t};")
A(f"\trootObject = {PROJECT};")
A("}")

with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(L) + "\n")
print("wrote", OUT)

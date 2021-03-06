"use strict";

function _interopDefault(ex) {
  return ex && "object" == typeof ex && "default" in ex ? ex.default : ex;
}

var meow = _interopDefault(require("meow")), errors = require("@changesets/errors"), logger = require("@changesets/logger"), util = require("util"), fs = _interopDefault(require("fs-extra")), path = _interopDefault(require("path")), getPackages = require("@manypkg/get-packages"), getDependentsGraph = require("@changesets/get-dependents-graph"), config = require("@changesets/config"), chalk = _interopDefault(require("chalk")), termSize = _interopDefault(require("term-size")), enquirer = require("enquirer"), git = require("@changesets/git"), writeChangeset = _interopDefault(require("@changesets/write")), semver = _interopDefault(require("semver")), boxen = _interopDefault(require("boxen")), outdent = _interopDefault(require("outdent")), applyReleasePlan = _interopDefault(require("@changesets/apply-release-plan")), readChangesets = _interopDefault(require("@changesets/read")), assembleReleasePlan = _interopDefault(require("@changesets/assemble-release-plan")), pre$1 = require("@changesets/pre"), pLimit = _interopDefault(require("p-limit")), preferredPM = _interopDefault(require("preferred-pm")), spawn = _interopDefault(require("spawndamnit")), isCI$1 = _interopDefault(require("is-ci")), table = _interopDefault(require("tty-table")), getReleasePlan = _interopDefault(require("@changesets/get-release-plan"));

const pkgPath = path.dirname(require.resolve("@changesets/cli/package.json"));

async function init(cwd) {
  const changesetBase = path.resolve(cwd, ".changeset");
  fs.existsSync(changesetBase) ? fs.existsSync(path.join(changesetBase, "config.json")) ? logger.warn("It looks like you already have changesets initialized. You should be able to run changeset commands no problems.") : (fs.existsSync(path.join(changesetBase, "config.js")) ? (logger.error("It looks like you're using the version 1 `.changeset/config.js` file"), 
  logger.error("The format of the config object has significantly changed in v2 as well"), 
  logger.error(" - we thoroughly recommend looking at the changelog for this package for what has changed"), 
  logger.error("Changesets will write the defaults for the new config, remember to transfer your options into the new config at `.changeset/config.json`")) : (logger.error("It looks like you don't have a config file"), 
  logger.info("The default config file will be written at `.changeset/config.json`")), 
  await fs.writeFile(path.resolve(changesetBase, "config.json"), JSON.stringify(config.defaultWrittenConfig, null, 2))) : (await fs.copy(path.resolve(pkgPath, "./default-files"), changesetBase), 
  await fs.writeFile(path.resolve(changesetBase, "config.json"), JSON.stringify(config.defaultWrittenConfig, null, 2)), 
  logger.log(chalk`Thanks for choosing {green changesets} to help manage your versioning and publishing\n`), 
  logger.log("You should be set up to start using changesets now!\n"), logger.info("We have added a `.changeset` folder, and a couple of files to help you out:"), 
  logger.info(chalk`- {blue .changeset/README.md} contains information about using changesets`), 
  logger.info(chalk`- {blue .changeset/config.json} is our default config`));
}

const serialId = function() {
  let id = 0;
  return () => id++;
}(), limit = Math.max(termSize().rows - 5, 10);

let cancelFlow = () => {
  logger.success("Cancelled... 👋 "), process.exit();
};

async function askCheckboxPlus(message, choices, format) {
  const name = `CheckboxPlus-${serialId()}`;
  return enquirer.prompt({
    type: "autocomplete",
    name: name,
    message: message,
    prefix: logger.prefix,
    multiple: !0,
    choices: choices,
    format: format,
    limit: limit,
    onCancel: cancelFlow
  }).then(responses => responses[name]).catch(err => {
    logger.error(err);
  });
}

async function askQuestion(message) {
  const name = `Question-${serialId()}`;
  return enquirer.prompt([ {
    type: "input",
    message: message,
    name: name,
    prefix: logger.prefix,
    onCancel: cancelFlow
  } ]).then(responses => responses[name]).catch(err => {
    logger.error(err);
  });
}

async function askConfirm(message) {
  const name = `Confirm-${serialId()}`;
  return enquirer.prompt([ {
    message: message,
    name: name,
    prefix: logger.prefix,
    type: "confirm",
    initial: !0,
    onCancel: cancelFlow
  } ]).then(responses => responses[name]).catch(err => {
    logger.error(err);
  });
}

async function askList(message, choices) {
  const name = `List-${serialId()}`;
  return enquirer.prompt([ {
    choices: choices,
    message: message,
    name: name,
    prefix: logger.prefix,
    type: "select",
    onCancel: cancelFlow
  } ]).then(responses => responses[name]).catch(err => {
    logger.error(err);
  });
}

const {green: green, yellow: yellow, red: red, bold: bold, blue: blue, cyan: cyan} = chalk;

async function confirmMajorRelease(pkgJSON) {
  if (semver.lt(pkgJSON.version, "1.0.0")) {
    return logger.log(yellow(`WARNING: Releasing a major version for ${green(pkgJSON.name)} will be its ${red("first major release")}.`)), 
    logger.log(yellow(`If you are unsure if this is correct, contact the package's maintainers ${red("before committing this changeset")}.`)), 
    await askConfirm(bold(`Are you sure you want still want to release the ${red("first major release")} of ${pkgJSON.name}?`));
  }
  return !0;
}

async function getPackagesToRelease(changedPackages, allPackages) {
  function askInitialReleaseQuestion(defaultChoiceList) {
    return askCheckboxPlus("Which packages would you like to include?", defaultChoiceList, x => Array.isArray(x) ? x.filter(x => "changed packages" !== x && "unchanged packages" !== x).map(x => cyan(x)).join(", ") : x);
  }
  if (allPackages.length > 1) {
    const unchangedPackagesNames = allPackages.map(({packageJson: packageJson}) => packageJson.name).filter(name => !changedPackages.includes(name)), defaultChoiceList = [ {
      name: "changed packages",
      choices: changedPackages
    }, {
      name: "unchanged packages",
      choices: unchangedPackagesNames
    } ].filter(({choices: choices}) => 0 !== choices.length);
    let packagesToRelease = await askInitialReleaseQuestion(defaultChoiceList);
    if (0 === packagesToRelease.length) do {
      logger.error("You must select at least one package to release"), logger.error("(You most likely hit enter instead of space!)"), 
      packagesToRelease = await askInitialReleaseQuestion(defaultChoiceList);
    } while (0 === packagesToRelease.length);
    return packagesToRelease.filter(pkgName => "changed packages" !== pkgName && "unchanged packages" !== pkgName);
  }
  return [ allPackages[0].packageJson.name ];
}

function formatPkgNameAndVersion(pkgName, version) {
  return `${bold(pkgName)}@${bold(version)}`;
}

async function createChangeset(changedPackages, allPackages) {
  const releases = [];
  if (allPackages.length > 1) {
    const packagesToRelease = await getPackagesToRelease(changedPackages, allPackages);
    let pkgJsonsByName = new Map(allPackages.map(({packageJson: packageJson}) => [ packageJson.name, packageJson ])), pkgsLeftToGetBumpTypeFor = new Set(packagesToRelease), pkgsThatShouldBeMajorBumped = (await askCheckboxPlus(bold(`Which packages should have a ${red("major")} bump?`), [ {
      name: "all packages",
      choices: packagesToRelease.map(pkgName => ({
        name: pkgName,
        message: formatPkgNameAndVersion(pkgName, pkgJsonsByName.get(pkgName).version)
      }))
    } ], x => Array.isArray(x) ? x.filter(x => "all packages" !== x).map(x => cyan(x)).join(", ") : x)).filter(x => "all packages" !== x);
    for (const pkgName of pkgsThatShouldBeMajorBumped) {
      let pkgJson = pkgJsonsByName.get(pkgName);
      await confirmMajorRelease(pkgJson) && (pkgsLeftToGetBumpTypeFor.delete(pkgName), 
      releases.push({
        name: pkgName,
        type: "major"
      }));
    }
    if (0 !== pkgsLeftToGetBumpTypeFor.size) {
      let pkgsThatShouldBeMinorBumped = (await askCheckboxPlus(bold(`Which packages should have a ${green("minor")} bump?`), [ {
        name: "all packages",
        choices: [ ...pkgsLeftToGetBumpTypeFor ].map(pkgName => ({
          name: pkgName,
          message: formatPkgNameAndVersion(pkgName, pkgJsonsByName.get(pkgName).version)
        }))
      } ], x => Array.isArray(x) ? x.filter(x => "all packages" !== x).map(x => cyan(x)).join(", ") : x)).filter(x => "all packages" !== x);
      for (const pkgName of pkgsThatShouldBeMinorBumped) pkgsLeftToGetBumpTypeFor.delete(pkgName), 
      releases.push({
        name: pkgName,
        type: "minor"
      });
    }
    if (0 !== pkgsLeftToGetBumpTypeFor.size) {
      logger.log(`The following packages will be ${blue("patch")} bumped:`), pkgsLeftToGetBumpTypeFor.forEach(pkgName => {
        logger.log(formatPkgNameAndVersion(pkgName, pkgJsonsByName.get(pkgName).version));
      });
      for (const pkgName of pkgsLeftToGetBumpTypeFor) releases.push({
        name: pkgName,
        type: "patch"
      });
    }
  } else {
    let pkg = allPackages[0], type = await askList(`What kind of change is this for ${green(pkg.packageJson.name)}? (current version is ${pkg.packageJson.version})`, [ "patch", "minor", "major" ]);
    if (console.log(type), "major" === type) {
      if (!await confirmMajorRelease(pkg.packageJson)) throw new errors.ExitError(1);
    }
    releases.push({
      name: pkg.packageJson.name,
      type: type
    });
  }
  logger.log("Please enter a summary for this change (this will be in the changelogs)");
  let summary = await askQuestion("Summary");
  for (;0 === summary.length; ) logger.error("A summary is required for the changelog! 😪"), 
  summary = await askQuestion("Summary");
  return {
    summary: summary,
    releases: releases
  };
}

function printConfirmationMessage(changeset, repoHasMultiplePackages) {
  function getReleasesOfType(type) {
    return changeset.releases.filter(release => release.type === type).map(release => release.name);
  }
  logger.log("=== Releasing the following packages ===");
  const majorReleases = getReleasesOfType("major"), minorReleases = getReleasesOfType("minor"), patchReleases = getReleasesOfType("patch");
  if (majorReleases.length > 0 && logger.log(`${chalk.green("[Major]")}\n  ${majorReleases.join(", ")}`), 
  minorReleases.length > 0 && logger.log(`${chalk.green("[Minor]")}\n  ${minorReleases.join(", ")}`), 
  patchReleases.length > 0 && logger.log(`${chalk.green("[Patch]")}\n  ${patchReleases.join(", ")}`), 
  repoHasMultiplePackages) {
    const message = outdent`
      ${chalk.red("========= NOTE ========")}
      All dependents of these packages that will be incompatible with the new version will be ${chalk.red("patch bumped")} when this changeset is applied.`, prettyMessage = boxen(message, {
      borderStyle: "double",
      align: "center"
    });
    logger.log(prettyMessage);
  }
}

async function add(cwd, {empty: empty}, config) {
  const packages = await getPackages.getPackages(cwd), changesetBase = path.resolve(cwd, ".changeset");
  let newChangeset, confirmChangeset;
  if (empty) newChangeset = {
    releases: [],
    summary: ""
  }, confirmChangeset = !0; else {
    const changePackagesName = (await git.getChangedPackagesSinceRef({
      cwd: cwd,
      ref: config.baseBranch
    })).filter(a => a).map(pkg => pkg.packageJson.name);
    newChangeset = await createChangeset(changePackagesName, packages.packages), printConfirmationMessage(newChangeset, packages.packages.length > 1), 
    confirmChangeset = await askConfirm("Is this your desired changeset?");
  }
  if (confirmChangeset) {
    const changesetID = await writeChangeset(newChangeset, cwd);
    config.commit ? (await git.add(path.resolve(changesetBase, `${changesetID}.md`), cwd), 
    await git.commit(`docs(changeset): ${newChangeset.summary}`, cwd), logger.log(chalk.green(`${empty ? "Empty " : ""}Changeset added and committed`))) : logger.log(chalk.green(`${empty ? "Empty " : ""}Changeset added! - you can now commit it\n`)), 
    [ ...newChangeset.releases ].find(c => "major" === c.type) ? (logger.warn("This Changeset includes a major change and we STRONGLY recommend adding more information to the changeset:"), 
    logger.warn("WHAT the breaking change is"), logger.warn("WHY the change was made"), 
    logger.warn("HOW a consumer should update their code")) : logger.log(chalk.green("If you want to modify or expand on the changeset summary, you can find it here")), 
    logger.info(chalk.blue(path.resolve(changesetBase, `${changesetID}.md`)));
  }
}

const removeEmptyFolders = async folderPath => {
  const dirContents = fs.readdirSync(folderPath);
  return Promise.all(dirContents.map(async contentPath => {
    const singleChangesetPath = path.resolve(folderPath, contentPath);
    try {
      (await fs.readdir(singleChangesetPath)).length < 1 && await fs.rmdir(singleChangesetPath);
    } catch (err) {
      if ("ENOTDIR" !== err.code) throw err;
    }
  }));
};

function ownKeys(object, enumerableOnly) {
  var keys = Object.keys(object);
  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    enumerableOnly && (symbols = symbols.filter((function(sym) {
      return Object.getOwnPropertyDescriptor(object, sym).enumerable;
    }))), keys.push.apply(keys, symbols);
  }
  return keys;
}

function _objectSpread(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = null != arguments[i] ? arguments[i] : {};
    i % 2 ? ownKeys(Object(source), !0).forEach((function(key) {
      _defineProperty(target, key, source[key]);
    })) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach((function(key) {
      Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
    }));
  }
  return target;
}

function _defineProperty(obj, key, value) {
  return key in obj ? Object.defineProperty(obj, key, {
    value: value,
    enumerable: !0,
    configurable: !0,
    writable: !0
  }) : obj[key] = value, obj;
}

let importantSeparator = chalk.red("===============================IMPORTANT!==============================="), importantEnd = chalk.red("----------------------------------------------------------------------");

async function version(cwd, options, config) {
  let [_changesets, _preState] = await Promise.all([ readChangesets(cwd), pre$1.readPreState(cwd), removeEmptyFolders(path.resolve(cwd, ".changeset")) ]);
  const changesets = _changesets, preState = _preState;
  if (void 0 !== preState && "pre" === preState.mode) {
    if (logger.warn(importantSeparator), void 0 !== options.snapshot) throw logger.error("Snapshot release is not allowed in pre mode"), 
    logger.log("To resolve this exit the pre mode by running `changeset pre exit`"), 
    new errors.ExitError(1);
    logger.warn("You are in prerelease mode"), logger.warn("If you meant to do a normal release you should revert these changes and run `changeset pre exit`"), 
    logger.warn("You can then run `changeset version` again to do a normal release"), 
    logger.warn(importantEnd);
  }
  if (0 === changesets.length && (void 0 === preState || "exit" !== preState.mode)) return void logger.warn("No unreleased changesets found, exiting.");
  let packages = await getPackages.getPackages(cwd), releasePlan = assembleReleasePlan(changesets, packages, config, preState, options.snapshot);
  await applyReleasePlan(releasePlan, packages, _objectSpread({}, config, {
    commit: !1
  }), options.snapshot), void 0 !== options.snapshot && config.commit ? logger.log("All files have been updated and committed. You're ready to publish!") : logger.log("All files have been updated. Review them and commit at your leisure");
}

var isCI = !(!isCI$1 && !process.env.GITHUB_ACTIONS);

const npmRequestLimit = pLimit(40);

function getCorrectRegistry() {
  return "https://registry.yarnpkg.com" === process.env.npm_config_registry ? void 0 : process.env.npm_config_registry;
}

async function getPublishTool(cwd) {
  const pm = await preferredPM(cwd);
  return pm && "pnpm" === pm.name ? "pnpm" : "npm";
}

async function getTokenIsRequired() {
  const envOverride = {
    npm_config_registry: getCorrectRegistry()
  };
  let profile, json = (await spawn("npm", [ "profile", "get", "--json" ], {
    env: Object.assign({}, process.env, envOverride)
  })).stdout.toString();
  if (json) try {
    profile = JSON.parse(json);
  } catch (err) {
    console.error(err, {
      json: json
    });
  }
  return profile && profile.tfa && "auth-and-writes" === profile.tfa.mode;
}

function getPackageInfo(pkgName) {
  return npmRequestLimit(async () => {
    logger.info(`npm info ${pkgName}`);
    const envOverride = {
      npm_config_registry: getCorrectRegistry()
    };
    const json = (await spawn("npm", [ "info", pkgName, "--json" ], {
      env: Object.assign({}, process.env, envOverride)
    })).stdout.toString();
    try {
      return JSON.parse(json);
    } catch (err) {
      console.error(err, {
        json: json
      });
    }
  });
}

async function infoAllow404(pkgName) {
  let pkgInfo = await getPackageInfo(pkgName);
  if (pkgInfo.error && "E404" === pkgInfo.error.code) return logger.warn(`Received 404 for npm info ${chalk.cyan(`"${pkgName}"`)}`), 
  {
    published: !1,
    pkgInfo: {}
  };
  if (pkgInfo.error) throw logger.error(`Received an unknown error code: ${pkgInfo.error.code} for npm info ${chalk.cyan(`"${pkgName}"`)}`), 
  logger.error(pkgInfo.error.summary), pkgInfo.error.detail && logger.error(pkgInfo.error.detail), 
  new errors.ExitError(1);
  return {
    published: !0,
    pkgInfo: pkgInfo
  };
}

let otpAskLimit = pLimit(1), askForOtpCode = twoFactorState => otpAskLimit(async () => {
  if (null !== twoFactorState.token) return twoFactorState.token;
  logger.info("This operation requires a one-time password from your authenticator.");
  let val = await askQuestion("Enter one-time password:");
  return twoFactorState.token = val, val;
}), getOtpCode = async twoFactorState => null !== twoFactorState.token ? twoFactorState.token : askForOtpCode(twoFactorState);

async function internalPublish(pkgName, opts, twoFactorState) {
  let publishTool = await getPublishTool(opts.cwd), publishFlags = opts.access ? [ "--access", opts.access ] : [];
  if (publishFlags.push("--tag", opts.tag), await twoFactorState.isRequired && !isCI) {
    let otpCode = await getOtpCode(twoFactorState);
    publishFlags.push("--otp", otpCode);
  }
  const envOverride = {
    npm_config_registry: getCorrectRegistry()
  };
  let {stdout: stdout} = await spawn(publishTool, [ "publish", "--json", ...publishFlags ], {
    cwd: opts.cwd,
    env: Object.assign({}, process.env, envOverride)
  });
  const json = stdout.toString().replace(/[^{]*/, "");
  let response;
  try {
    response = JSON.parse(json);
  } catch (err) {
    console.error(err, {
      stdout: stdout,
      json: json
    });
  }
  return !response || response && response.error ? ("EOTP" === response.error.code || "E401" === response.error.code && response.error.detail.includes("--otp=<code>")) && !isCI ? (null !== twoFactorState.token && (twoFactorState.token = null), 
  twoFactorState.isRequired = Promise.resolve(!0), internalPublish(pkgName, opts, twoFactorState)) : (logger.error(`an error occurred while publishing ${pkgName}: ${response.error.code}`, response.error.summary, response.error.detail ? "\n" + response.error.detail : ""), 
  {
    published: !1
  }) : {
    published: !0
  };
}

function publish(pkgName, opts, twoFactorState) {
  return npmRequestLimit(() => internalPublish(pkgName, opts, twoFactorState));
}

function getReleaseTag(pkgInfo, preState, tag) {
  return tag || (void 0 !== preState && "only-pre" !== pkgInfo.publishedState ? preState.tag : "latest");
}

async function publishPackages({packages: packages, access: access, otp: otp, preState: preState, tag: tag}) {
  const packagesByName = new Map(packages.map(x => [ x.packageJson.name, x ])), publicPackages = packages.filter(pkg => !pkg.packageJson.private);
  let twoFactorState = void 0 === otp ? {
    token: null,
    isRequired: isCI || publicPackages.some(x => x.packageJson.publishConfig && x.packageJson.publishConfig.registry && "https://registry.npmjs.org" !== x.packageJson.publishConfig.registry && "https://registry.yarnpkg.com" !== x.packageJson.publishConfig.registry) || void 0 !== process.env.npm_config_registry && "https://registry.npmjs.org" !== process.env.npm_config_registry && "https://registry.yarnpkg.com" !== process.env.npm_config_registry ? Promise.resolve(!1) : getTokenIsRequired()
  } : {
    token: otp,
    isRequired: Promise.resolve(!0)
  };
  const unpublishedPackagesInfo = await getUnpublishedPackages(publicPackages, preState);
  0 === unpublishedPackagesInfo.length && logger.warn("No unpublished packages to publish");
  let promises = [];
  for (let pkgInfo of unpublishedPackagesInfo) {
    let pkg = packagesByName.get(pkgInfo.name);
    promises.push(publishAPackage(pkg, access, twoFactorState, getReleaseTag(pkgInfo, preState, tag)));
  }
  return Promise.all(promises);
}

async function publishAPackage(pkg, access, twoFactorState, tag) {
  const {name: name, version: version, publishConfig: publishConfig} = pkg.packageJson, localAccess = publishConfig && publishConfig.access;
  logger.info(`Publishing ${chalk.cyan(`"${name}"`)} at ${chalk.green(`"${version}"`)}`);
  const publishDir = pkg.dir;
  return {
    name: name,
    newVersion: version,
    published: (await publish(name, {
      cwd: publishDir,
      access: localAccess || access,
      tag: tag
    }, twoFactorState)).published
  };
}

async function getUnpublishedPackages(packages, preState) {
  const results = await Promise.all(packages.map(async pkg => {
    const config = pkg.packageJson, response = await infoAllow404(config.name);
    let publishedState = "never";
    return response.published && (publishedState = "published", void 0 !== preState && response.pkgInfo.versions && response.pkgInfo.versions.every(version => semver.parse(version).prerelease[0] === preState.tag) && (publishedState = "only-pre")), 
    {
      name: config.name,
      localVersion: config.version,
      publishedState: publishedState,
      publishedVersions: response.pkgInfo.versions || []
    };
  })), packagesToPublish = [];
  for (const pkgInfo of results) {
    const {name: name, publishedState: publishedState, localVersion: localVersion, publishedVersions: publishedVersions} = pkgInfo;
    publishedVersions.includes(localVersion) ? logger.warn(`${name} is not being published because version ${localVersion} is already published on npm`) : (packagesToPublish.push(pkgInfo), 
    logger.info(`${name} is being published because our local version (${localVersion}) has not been published on npm`), 
    void 0 !== preState && "only-pre" === publishedState && logger.info(`${name} is being published to ${chalk.cyan("latest")} rather than ${chalk.cyan(preState.tag)} because there has not been a regular release of it yet`));
  }
  return packagesToPublish;
}

function logReleases(pkgs) {
  const mappedPkgs = pkgs.map(p => `${p.name}@${p.newVersion}`).join("\n");
  logger.log(mappedPkgs);
}

let importantSeparator$1 = chalk.red("===============================IMPORTANT!==============================="), importantEnd$1 = chalk.red("----------------------------------------------------------------------");

function showNonLatestTagWarning(tag, preState) {
  logger.warn(importantSeparator$1), preState ? logger.warn(`You are in prerelease mode so packages will be published to the ${chalk.cyan(preState.tag)}\n        dist tag except for packages that have not had normal releases which will be published to ${chalk.cyan("latest")}`) : "latest" !== tag && logger.warn(`Packages will be released under the ${tag} tag`), 
  logger.warn(importantEnd$1);
}

async function run(cwd, {otp: otp, tag: tag}, config) {
  const releaseTag = tag && tag.length > 0 ? tag : void 0;
  let preState = await pre$1.readPreState(cwd);
  if (releaseTag && preState && "pre" === preState.mode) throw logger.error("Releasing under custom tag is not allowed in pre mode"), 
  logger.log("To resolve this exit the pre mode by running `changeset pre exit`"), 
  new errors.ExitError(1);
  (releaseTag || preState) && showNonLatestTagWarning(tag, preState);
  const {packages: packages, tool: tool} = await getPackages.getPackages(cwd), response = await publishPackages({
    packages: packages,
    access: config.access,
    otp: otp,
    preState: preState,
    tag: releaseTag
  }), successful = response.filter(p => p.published), unsuccessful = response.filter(p => !p.published);
  if (successful.length > 0) if (logger.success("packages published successfully:"), 
  logReleases(successful), logger.log(`Creating git tag${successful.length > 1 ? "s" : ""}...`), 
  "root" !== tool) for (const pkg of successful) {
    const tag = `${pkg.name}@${pkg.newVersion}`;
    logger.log("New tag: ", tag), await git.tag(tag, cwd);
  } else {
    const tag = `v${successful[0].newVersion}`;
    logger.log("New tag: ", tag), await git.tag(tag, cwd);
  }
  if (unsuccessful.length > 0) throw logger.error("packages failed to publish:"), 
  logReleases(unsuccessful), new errors.ExitError(1);
}

async function getStatus(cwd, {sinceMaster: sinceMaster, since: since, verbose: verbose, output: output}, config) {
  sinceMaster && (logger.warn("--sinceMaster is deprecated and will be removed in a future major version"), 
  logger.warn("Use --since=master instead"));
  const releasePlan = await getReleasePlan(cwd, void 0 === since ? sinceMaster ? "master" : void 0 : since, config), {changesets: changesets, releases: releases} = releasePlan;
  if (changesets.length < 1 && (logger.error("No changesets present"), process.exit(1)), 
  output) return void await fs.writeFile(path.join(cwd, output), JSON.stringify(releasePlan, void 0, 2));
  const print = verbose ? verbosePrint : SimplePrint;
  return print("patch", releases), logger.log("---"), print("minor", releases), logger.log("---"), 
  print("major", releases), releasePlan;
}

function SimplePrint(type, releases) {
  const packages = releases.filter(r => r.type === type);
  if (packages.length) {
    logger.info(chalk`Packages to be bumped at {green ${type}}:\n`);
    const pkgs = packages.map(({name: name}) => `- ${name}`).join("\n");
    logger.log(chalk.green(pkgs));
  } else logger.info(chalk`{red NO} packages to be bumped at {green ${type}}`);
}

function verbosePrint(type, releases) {
  const packages = releases.filter(r => r.type === type);
  if (packages.length) {
    logger.info(chalk`Packages to be bumped at {green ${type}}`);
    const columns = packages.map(({name: name, newVersion: version, changesets: changesets}) => [ chalk.green(name), version, changesets.map(c => chalk.blue(` .changeset/${c}/changes.md`)).join(" +") ]), t1 = table([ {
      value: "Package Name",
      width: 20
    }, {
      value: "New Version",
      width: 20
    }, {
      value: "Related Changeset Summaries",
      width: 70
    } ], columns, {
      paddingLeft: 1,
      paddingRight: 0,
      headerAlign: "center",
      align: "left"
    });
    logger.log(t1.render() + "\n");
  } else logger.info(chalk`Running release would release {red NO} packages as a {green ${type}}`);
}

async function pre(cwd, options) {
  if ("enter" === options.command) try {
    await pre$1.enterPre(cwd, options.tag), logger.success(`Entered pre mode with tag ${chalk.cyan(options.tag)}`), 
    logger.info("Run `changeset version` to version packages with prerelease versions");
  } catch (err) {
    if (err instanceof errors.PreEnterButInPreModeError) throw logger.error("`changeset pre enter` cannot be run when in pre mode"), 
    logger.info("If you're trying to exit pre mode, run `changeset pre exit`"), new errors.ExitError(1);
    throw err;
  } else try {
    await pre$1.exitPre(cwd), logger.success("Exited pre mode"), logger.info("Run `changeset version` to version packages with normal versions");
  } catch (err) {
    if (err instanceof errors.PreExitButNotInPreModeError) throw logger.error("`changeset pre exit` can only be run when in pre mode"), 
    logger.info("If you're trying to enter pre mode, run `changeset pre enter`"), new errors.ExitError(1);
    throw err;
  }
}

async function run$1(input, flags, cwd) {
  if ("init" === input[0]) return void await init(cwd);
  if (!fs.existsSync(path.resolve(cwd, ".changeset"))) throw logger.error("There is no .changeset folder. "), 
  logger.error("If this is the first time `changesets` have been used in this project, run `yarn changeset init` to get set up."), 
  logger.error("If you expected there to be changesets, you should check git history for when the folder was removed to ensure you do not lose any configuration."), 
  new errors.ExitError(1);
  const packages = await getPackages.getPackages(cwd);
  let config$1;
  try {
    config$1 = await config.read(cwd, packages);
  } catch (e) {
    throw await fs.pathExists(path.resolve(cwd, ".changeset/config.js")) ? (logger.error("It looks like you're using the version 1 `.changeset/config.js` file"), 
    logger.error("You'll need to convert it to a `.changeset/config.json` file"), logger.error("The format of the config object has significantly changed in v2 as well"), 
    logger.error(" - we thoroughly recommend looking at the changelog for this package for what has changed"), 
    new errors.ExitError(1)) : e;
  }
  if (input.length < 1) {
    const {empty: empty} = flags;
    await add(cwd, {
      empty: empty
    }, config$1);
  } else if ("pre" !== input[0] && input.length > 1) logger.error("Too many arguments passed to changesets - we only accept the command name as an argument"); else {
    const {sinceMaster: sinceMaster, since: since, verbose: verbose, output: output, otp: otp, empty: empty, ignore: ignore, snapshot: snapshot, tag: tag} = flags;
    switch ([ "updateChangelog", "isPublic", "skipCI", "commit" ].forEach(flag => {
      if (flags[flag]) throw logger.error(`the flag ${flag} has been removed from changesets for version 2`), 
      logger.error("Please encode the desired value into your config"), logger.error("See our changelog for more details"), 
      new errors.ExitError(1);
    }), input[0]) {
     case "add":
      return void await add(cwd, {
        empty: empty
      }, config$1);

     case "version":
      {
        let ignoreArrayFromCmd;
        ignoreArrayFromCmd = "string" == typeof ignore ? [ ignore ] : ignore;
        let pkgNames = new Set(packages.packages.map(({packageJson: packageJson}) => packageJson.name));
        const messages = [];
        for (const pkgName of ignoreArrayFromCmd || []) pkgNames.has(pkgName) || messages.push(`The package "${pkgName}" is passed to the \`--ignore\` option but it is not found in the project. You may have misspelled the package name.`);
        config$1.ignore.length > 0 && ignoreArrayFromCmd ? messages.push("It looks like you are trying to use the `--ignore` option while ignore is defined in the config file. This is currently not allowed, you can only use one of them at a time.") : ignoreArrayFromCmd && (config$1.ignore = ignoreArrayFromCmd);
        const dependentsGraph = getDependentsGraph.getDependentsGraph(packages);
        for (const ignoredPackage of config$1.ignore) {
          const dependents = dependentsGraph.get(ignoredPackage) || [];
          for (const dependent of dependents) config$1.ignore.includes(dependent) || messages.push(`The package "${dependent}" depends on the ignored package "${ignoredPackage}", but "${dependent}" is not being ignored. Please pass "${dependent}" to the \`--ignore\` flag.`);
        }
        if (messages.length > 0) throw logger.error(messages.join("\n")), new errors.ExitError(1);
        return void await version(cwd, {
          snapshot: snapshot
        }, config$1);
      }

     case "publish":
      return void await run(cwd, {
        otp: otp,
        tag: tag
      }, config$1);

     case "status":
      return void await getStatus(cwd, {
        sinceMaster: sinceMaster,
        since: since,
        verbose: verbose,
        output: output
      }, config$1);

     case "pre":
      {
        let command = input[1];
        if ("enter" !== command && "exit" !== command) throw logger.error("`enter`, `exit` or `snapshot` must be passed after prerelease"), 
        new errors.ExitError(1);
        let tag = input[2];
        if ("enter" === command && "string" != typeof tag) throw logger.error("A tag must be passed when using prerelese enter"), 
        new errors.ExitError(1);
        return void await pre(cwd, {
          command: command,
          tag: tag
        });
      }

     case "bump":
      throw logger.error('In version 2 of changesets, "bump" has been renamed to "version" - see our changelog for an explanation'), 
      logger.error("To fix this, use `changeset version` instead, and update any scripts that use changesets"), 
      new errors.ExitError(1);

     case "release":
      throw logger.error('In version 2 of changesets, "release" has been renamed to "publish" - see our changelog for an explanation'), 
      logger.error("To fix this, use `changeset publish` instead, and update any scripts that use changesets"), 
      new errors.ExitError(1);

     default:
      throw logger.error(`Invalid command ${input[0]} was provided`), new errors.ExitError(1);
    }
  }
}

const {input: input, flags: flags} = meow("\n  Usage\n    $ changesets [command]\n  Commands\n    init\n    add [--empty]\n    version [--ignore]\n    publish [--otp=code]\n    status [--since-master --verbose --output=JSON_FILE.json]\n    prerelease <tag>\n    ", {
  flags: {
    sinceMaster: {
      type: "boolean"
    },
    verbose: {
      type: "boolean",
      alias: "v"
    },
    output: {
      type: "string",
      alias: "o"
    },
    otp: {
      type: "string",
      default: void 0
    },
    empty: {
      type: "boolean"
    },
    since: {
      type: "string",
      default: void 0
    },
    ignore: {
      type: "string",
      default: void 0,
      isMultiple: !0
    },
    tag: {
      type: "string"
    }
  }
}), cwd = process.cwd();

run$1(input, flags, cwd).catch(err => {
  if (err instanceof errors.InternalError && (logger.error("The following error is an internal unexpected error, these should never happen."), 
  logger.error("Please open an issue with the following link"), logger.error(`https://github.com/atlassian/changesets/issues/new?title=${encodeURIComponent(`Unexpected error during ${input[0] || "add"} command`)}&body=${encodeURIComponent(`## Error\n\n\`\`\`\n${util.format("", err).replace(process.cwd(), "<cwd>")}\n\`\`\`\n\n## Versions\n\n- @changesets/cli@${require("@changesets/cli/package.json").version}\n- node@${process.version}\n\n## Extra details\n\n\x3c!-- Add any extra details of what you were doing, ideas you have about what might have caused the error and reproduction steps if possible. If you have a repository we can look at that would be great. 😁 --\x3e\n`)}`)), 
  err instanceof errors.ExitError) return process.exit(err.code);
  logger.error(err), process.exit(1);
});

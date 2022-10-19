/* eslint-disable @typescript-eslint/no-var-requires */
// 参考 https://npmjs.com/release  https://github.com/vuejs/core/blob/main/scripts/release.js

import semver from "semver";
import { execa } from "execa";
import chalk from "chalk";
import inquirer from "inquirer";
import minimist from "minimist";
import path from "path";
import fs from "fs";
import pkg from "../package.json" assert { type: "json" };

const cwd = process.cwd();
const args = minimist(process.argv.slice(2));
const currentVersion = pkg.version;
const preid =
  args.preid ||
  (semver.prerelease(currentVersion) && semver.prerelease(currentVersion)[0]);

// 打印当前版本
function printCurrentVersion() {
  console.info(
    chalk.bgBlack(
      `\n${"".padStart(EMPTY_COUNT)}${chalk.white("当前版本是:  ")}${chalk.red(
        chalk.bold(currentVersion)
      )}${"".padStart(EMPTY_COUNT)}\n`
    )
  );
}

// 确保 git 工作区干净
async function confirmIfGitDirty() {
  const { stdout } = await execa("git", ["status", "--porcelain"], { cwd });
  if (!stdout) return true;

  console.warn(
    chalk.yellow("当前存储库中有未提交的更改，建议先提交或保存它们。")
  );

  const { ok } = await inquirer.prompt([
    {
      name: "ok",
      type: "confirm",
      message: "仍然继续？",
      default: false,
    },
  ]);

  return ok;
}

// 获取版本升级配置表
function getVersionTypeChoices() {
  const joinName = (config) => {
    const versionDiff = `${currentVersion} -> ${semver.inc(
      currentVersion,
      config.value,
      preid
    )} `;

    return `${config.name}${versionDiff.padStart(
      versionDiff.length + (EMPTY_COUNT - config.name.length)
    )}`;
  };

  return BASIC_VERSION_CONFIG.concat(preid ? PRE_VERSION_CONFIG : [])
    .map((config) => ({
      ...config,
      name: joinName(config),
    }))
    .concat(CUSTOM_VERSION_CONFIG);
}

// 确认发布的版本号
async function confirmReleaseVersion() {
  let version = args._[0];

  if (!version) {
    const { releaseType } = await inquirer.prompt({
      type: "list",
      name: "releaseType",
      message: "选择发布类型",
      choices: getVersionTypeChoices(),
    });
    if (releaseType === "custom") {
      const { customVersion } = await inquirer.prompt({
        type: "input",
        name: "customVersion",
        message: "输入自定义版本",
        initial: currentVersion,
      });
      version = customVersion;
    } else {
      version = semver.inc(currentVersion, releaseType, preid);
    }
  }

  if (!semver.valid(version)) {
    throw new Error(`无效的版本: ${version}`);
  }

  const { yes } = await inquirer.prompt({
    type: "confirm",
    name: "yes",
    message: `将发布的版本号为 v${version} 确认?`,
  });

  if (!yes) process.exit(0); // 废弃版本

  return version;
}

function run(bin, args, opts = {}) {
  return execa(bin, args, { stdio: "inherit", ...opts });
}

function logInfo(msg) {
  console.info(chalk.cyan(msg));
}

function updateVersions(version) {
  const pkgPath = path.resolve(cwd, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

async function release() {
  if (!(await confirmIfGitDirty())) return;

  const releaseVersion = await confirmReleaseVersion();

  logInfo("\n  🛂 检查 TypeScirpt 类型...");
  await run("pnpm", ["run", "type:check", "--bail"]);

  logInfo("  💄 格式化项目代码...");
  await run("pnpm", ["run", "lint", "--bail"]);

  logInfo("  🤡 运行单元测试...");
  await run("pnpm", ["test:unit", "--bail"]); // https://pnpm.io/cli/recursive#--no-bail

  logInfo("\n  🧹 清除资源文件...");
  await run("pnpm", ["run", "clean", "--bail"]);

  logInfo("  🦾 生成 TypeScirpt 类型声明文件...");
  await run("pnpm", ["run", "type:build", "--bail"]);

  logInfo("  📦 打包项目...");
  await run("pnpm", ["run", "build:js", "--bail"]);

  logInfo("\n  🧩 写入发布版本号...\n");
  updateVersions(releaseVersion);

  logInfo("  🔖 生成 CHANGELOG.md...");
  await run(`pnpm`, ["run", "changelog", "--bail"]);

  const { stdout } = await run("git", ["diff"], { stdio: "pipe" });
  if (stdout) {
    logInfo("  🧿 提交变更中...\n");
    await run("git", ["add", "-A"]);
    await run("git", ["commit", "-m", `release: v${releaseVersion}`]);
  } else {
    console.log("没有要提交的更改。");
  }

  logInfo("\n  🚀 发布 npm 包...\n");
  await run("pnpm", ["publish"]);

  logInfo("\n  🤖 推送到远端仓库（GitHub）...\n");
  await run("git", ["tag", `v${releaseVersion}`]);
  await run("git", ["push", "origin", `refs/tags/v${releaseVersion}`]);
  await run("git", ["push"]);

  logInfo("\n  ✨ 完成！");
}

async function main() {
  printCurrentVersion();

  if (args.h || args.help) {
    printHelp();
  } else {
    await release();
  }
}

function printHelp() {
  console.log(`-----------------------------------------------------------------------------------
                      【 执行 pnpm release 发布项目 】

  1. 基础版本类型 ( ${chalk.cyan("[Major].[Minor].[Patch]")} )
${BASIC_VERSION_CONFIG.map(
  (config) =>
    `     ${chalk.cyan(config.name)}${"---".padStart(
      EMPTY_COUNT - config.name.length
    )} ${chalk.gray(config.description)}`
).join("\n")}

  2. 预发版本类型 ( ${chalk.cyan("[Major].[Minor].[Patch]-[alpha|beta|rc].0")} )
${PRE_VERSION_CONFIG.map(
  (config) =>
    `     ${chalk.cyan(config.name)}${"---".padStart(
      EMPTY_COUNT - config.name.length
    )} ${chalk.gray(config.description)}`
).join("\n")}

  3. 预发版本修饰类型
${PRE_VERSION_SUFFIX.map(
  (config) =>
    `     ${chalk.cyan(config.name)}${"---".padStart(
      EMPTY_COUNT + EMPTY_COUNT / 2 - config.name.length
    )} ${chalk.gray(config.description)}`
).join("\n")}

  4. 自定义填写版本 release 脚本允许你自定义版本前提是符合 semver 版本语义

-----------------------------------------------------------------------------------
  `);
  console.log();
}

const EMPTY_COUNT = 15;
const BASIC_VERSION_CONFIG = [
  {
    value: "patch",
    name: "Patch",
    description: "进行向后兼容的 BUG 修复时",
  },
  {
    value: "minor",
    name: "Minor",
    description: "以向后兼容的方式添加功能时",
  },
  {
    value: "major",
    name: "Major",
    description: "进行不兼容的 API 更改时",
  },
];
const PRE_VERSION_CONFIG = [
  {
    value: "prepatch",
    name: "Prepatch",
    description: "补丁版本的预发布",
  },
  {
    value: "preminor",
    name: "Preminor",
    description: "次要版本的预发布",
  },
  {
    value: "premajor",
    name: "Premajor",
    description: "主要版本的预发布",
  },
  {
    value: "prerelease",
    name: "Prerelease",
    description: "预发布",
  },
];
const CUSTOM_VERSION_CONFIG = [
  {
    value: "custom",
    name: "Custom",
    description: "自定义填写所需发布的版本号",
  },
];
const PRE_VERSION_SUFFIX = [
  {
    name: "Alpha",
    value: "alpha",
    description: "内部测试版本，存在 BUG 且不稳定",
  },
  {
    name: "Beta",
    value: "beta",
    description: "较 Alpha 版本有较大改进，但仍存在缺陷，需要经过处理改进",
  },
  {
    name: "Release Candidate",
    value: "rc",
    description:
      "候选发布版本，一般不引入新功能，用于解决错误，正式版前的最后一个版本",
  },
  {
    name: "Other",
    value: "other",
    description: "其它自定义修饰类型",
  },
];

main().catch((err) => {
  console.log("--err---");
  updateVersions(currentVersion);
  console.error(err);
});

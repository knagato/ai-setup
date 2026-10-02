// インストール手順の組み立て方（strategy）。どれも Step[] を返すだけで、副作用は持たない。
// 実行は runner.js が受け持つので、ここはテストで手順を固定値と照合できる。
//
//   (install, ctx, release) => Step[]
//   install: カタログの platforms.<os>.install / ctx: platform.makeContext() / release: resolvers の結果

module.exports = {
  officialScript: require("./official-script"),
  macAppZip: require("./mac-app-zip"),
  winInstaller: require("./win-installer"),
};

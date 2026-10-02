// macOS の Git は Xcode のコマンドライン・ツール（CLT）に入っている。入れるのは OS のダイアログで、
// runner は「ダイアログを出して、入り終わるまで待つ」だけをする。
module.exports = function xcodeClt() {
  return [{ kind: "xcodeClt" }];
};

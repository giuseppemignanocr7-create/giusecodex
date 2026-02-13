(function () {
  if (!window.Prism) {
    return;
  }

  const base = Prism.languages.sql || Prism.languages.clike || {};

  Prism.languages.prisma = Prism.languages.extend(base, {
    keyword:
      /\b(?:model|enum|datasource|generator|type|extends|map|dbgenerated|default|relation|onDelete|onUpdate|references|fields|@@index|@@unique|@@id|@@map|@id|@default|@relation|@updatedAt|@map|@db\.[A-Za-z_][\w.]*)\b/,
    boolean: /\b(?:true|false)\b/,
    number: /\b\d+(?:\.\d+)?\b/
  });
})();

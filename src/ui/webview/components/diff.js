(function () {
  function createDiffBlock(diff) {
    const block = document.createElement('section');
    block.className = 'gc-diff-block';

    const header = document.createElement('div');
    header.className = 'gc-diff-header';

    const title = document.createElement('span');
    title.textContent = `Diff Preview`;

    const path = document.createElement('code');
    path.textContent = diff && diff.path ? diff.path : 'active file';

    header.appendChild(title);
    header.appendChild(path);
    block.appendChild(header);

    const lines = Array.isArray(diff && diff.lines) ? diff.lines : [];
    if (!lines.length) {
      const line = document.createElement('div');
      line.className = 'gc-diff-line context';
      line.textContent = 'No differences available.';
      block.appendChild(line);
      return block;
    }

    lines.forEach((entry) => {
      const line = document.createElement('div');
      const type = entry && typeof entry.type === 'string' ? entry.type : 'context';
      line.className = `gc-diff-line ${type}`;
      line.textContent = entry && typeof entry.text === 'string' ? entry.text : '';
      block.appendChild(line);
    });

    return block;
  }

  window.GiuseCoderDiff = {
    createDiffBlock
  };
})();

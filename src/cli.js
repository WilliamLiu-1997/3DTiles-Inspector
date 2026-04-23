const { InspectorError } = require('./errors');
const { runInspector } = require('./viewer-core');

function usage() {
  return [
    'Usage: 3dtiles-inspector [options] <tileset_json>',
    '',
    'Options:',
    '  --help',
  ].join('\n');
}

function parseArgs(argv) {
  let help = false;
  const positionals = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }
    if (token.startsWith('--')) {
      throw new InspectorError(`Unknown option ${token}`);
    }
    positionals.push(token);
  }

  if (help) {
    return { help: true, tilesetPath: null };
  }

  if (positionals.length === 0) {
    throw new InspectorError('Missing <tileset_json>.');
  }

  if (positionals.length > 1) {
    throw new InspectorError(`Unexpected positional argument: ${positionals[1]}`);
  }

  return { help: false, tilesetPath: positionals[0] };
}

async function run(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      console.log(usage());
      return 0;
    }
    await runInspector(args.tilesetPath);
    return 0;
  } catch (err) {
    if (err instanceof InspectorError) {
      console.error(`Inspector failed: ${err.message}`);
    } else if (err != null) {
      console.error(err.message || String(err));
    }
    return 2;
  }
}

module.exports = {
  run,
  usage,
  parseArgs,
};

if (require.main === module) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err && err.message ? err.message : String(err));
      process.exit(2);
    });
}

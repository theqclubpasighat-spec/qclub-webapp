import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Check both the emitted module graph and the final files after PWA generation.
export function isolatedBuildOutput({ adminPreview, v2Preview }) {
  let config;
  return {
    name: 'qclub-isolated-build-output',
    apply: 'build',
    configResolved(value) { config = value; },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of Object.keys(chunk.modules)) {
          const normalized = id.replaceAll('\\', '/');
          const rehearsalAdminEntry = /\/src\/admin-preview\/(?:entry\.jsx|client\.mjs)$/.test(normalized);
          const checkoutPreview = normalized.includes('/src/checkout-preview/');
          if ((!adminPreview && (rehearsalAdminEntry || checkoutPreview)) ||
              (!v2Preview && normalized.includes('/src/v2-preview/'))) {
            this.error(`Disabled preview module found in output: ${id}`);
          }
        }
      }
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        const forbidden = [
          ...(!adminPreview ? ['qclub.rehearsal.checkout.v1', 'Update the words your players see.'] : []),
          ...(!v2Preview ? ['Design preview', 'v2-product-grid'] : []),
        ];
        const inspect = directory => {
          for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) inspect(file);
            else if (/\.(?:js|css|html)$/.test(entry.name)) {
              const source = readFileSync(file, 'utf8');
              if (forbidden.some(marker => source.includes(marker))) {
                this.error(`Disabled preview code found in generated file: ${file}`);
              }
            }
          }
        };
        inspect(path.resolve(config.root, config.build.outDir));
      },
    },
  };
}

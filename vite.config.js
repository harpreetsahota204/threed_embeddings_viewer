import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/index.tsx',
      name: 'ThreeDEmbeddingsPlugin',
      fileName: 'index',
      formats: ['umd']
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'recoil',
        '@fiftyone/operators',
        '@fiftyone/plugins',
        '@fiftyone/state',
        '@fiftyone/utilities'
      ],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          recoil: 'recoil',
          '@fiftyone/operators': '__foo__',
          '@fiftyone/plugins': '__fop__',
          '@fiftyone/state': '__fos__',
          '@fiftyone/utilities': '__fou__'
        }
      }
    }
  }
});


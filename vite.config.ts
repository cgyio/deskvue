import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type BuildEnvironmentOptions } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
    //局域网内访问
    server: {
        host: '0.0.0.0',
        port: 5173,
    },
    plugins: [vue(), vueDevTools(), tailwindcss()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
            '@stores': fileURLToPath(new URL('./src/stores', import.meta.url)),
            '@types': fileURLToPath(new URL('./src/types', import.meta.url)),
            '@hooks': fileURLToPath(new URL('./src/hooks', import.meta.url)),
            '@styles': fileURLToPath(new URL('./src/styles', import.meta.url)),
            '@utils': fileURLToPath(new URL('./src/utils', import.meta.url)),
            '@business': fileURLToPath(new URL('./src/business', import.meta.url)),
        },
    },

    // 打包成浏览器 CDN 组件库（核心配置）
    build: {
        lib: {
            //!! 编译 Deskvue 库
            entry: './src/Deskvue.ts',
            name: 'Deskvue',
            fileName: 'deskvue',

            //!! 编译 业务库
            //entry: './src/components/business/[foo-bar]/index.ts',
            //name: 'FooBar',
            //fileName: 'foo-bar',

            formats: ['iife'],
        },
        rolldownOptions: {
            // 外部化：不打包进库，由 CDN 提供
            //!! 编译 Deskvue 库
            external: [
                'vue',
                'element-plus',
                'pinia',
                'pinia-plugin-persistedstate',
                '@vueuse/core',
                'js-md5',
            ],
            //!! 编译 业务库
            //external: ['vue', 'element-plus', 'pinia', 'pinia-plugin-persistedstate', '@vueuse/core', '@/Deskvue'],
            output: {
                globals: {
                    vue: 'Vue',
                    'element-plus': 'ElementPlus',
                    pinia: 'Pinia',
                    'pinia-plugin-persistedstate': 'piniaPluginPersistedstate',
                    '@vueuse/core': 'VueUse',
                    'js-md5': 'md5',

                    //!! 编译 业务库
                    //'@/Deskvue': 'Deskvue',
                },
            },
        },
    },
})

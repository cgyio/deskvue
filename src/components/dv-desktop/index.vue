<script setup lang="ts">
/**
 * DvDesktop 用户桌面
 * 系统程序
 */
import { ref, computed } from 'vue'
import type { DvFsProgramMeta } from '@/kernel'
import { useDvProgramHook } from '@/kernel'

defineOptions({
    name: 'DvDesktop',
    programMeta: {
        name: 'DvDesktop',
        title: '桌面',
        desc: 'Deskvue 系统的用户桌面程序',
        isSysProgram: true,
        mimes: ['*.shortcut', '*.widget'],
    } as DvFsProgramMeta,
})
</script>

<script setup lang="ts">
/**
 * DvWinService 窗口管理系统服务
 * 内核级别的 service，全局单例，自启动，早于用户登录
 */
import { ref, computed } from 'vue'
import { useDvProgram, type DvFsProgramMeta } from '@/kernel'

defineOptions({
    name: 'DvWinService',
    programMeta: {
        name: 'DvWinService',
        title: '窗口管理服务',
        desc: 'Deskvue 系统的窗口管理服务',
        isService: true,
        mimes: ['*.shortcut', '*.widget'],
        gui: {},
    } as DvFsProgramMeta,
})
</script>

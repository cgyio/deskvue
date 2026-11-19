<script setup lang="ts">
/**
 * DvGuiService 用户界面系统服务
 * 内核级别的 service，全局单例，自启动，早于用户登录
 */
import { ref, computed } from 'vue'
import { useDvProgram, type DvFsProgramMeta } from '@/kernel'

defineOptions({
    name: 'DvGuiService',
    programMeta: {
        name: 'DvGuiService',
        title: '用户界面服务',
        desc: 'Deskvue 系统的 GUI 服务',
        isService: true,
        mimes: ['*.shortcut', '*.widget'],
        gui: {},
    } as DvFsProgramMeta,
})
</script>

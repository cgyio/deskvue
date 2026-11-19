/**
 * Deskvue kernel
 * 系统配置参数，内容保存在 FS 文件系统 /sys/config 中
 * !! 此配置内容在首次加载后，将会被持久化到 dvHdd.fs.sys.config._content_ 中
 * 在执行系统更新后，系统配置内容可能会被修改，与此处的原始定义不同
 */

export const dvConfig = {
    version: '0.0.1',
    iso: {
        'ms.qypms': {
            iso: 'ms.qypms',
            name: '乾耀PMS',
            baseUrl: 'https://ms.systech.work/qypms',
            logo: 'https://io.cgy.design/icon/qy-pms${dark}${expand}',
        },
    },
    service: {
        cli: {
            //解析 输入输出字符串 参数
            parser: {
                //cell 分割标记
                cellsep: ['<{{', '}}>'],
                //cell 内容分割标记
                cntsep: '::',
                //class 分割标记
                clssep: '.',
                //style 分割标记
                stysep: ';',
                //默认的 命令行显示 html 样式类前缀
                clspre: 'dv-buffer',
            },
            //输入输出缓冲最大缓存行数
            maxRow: 256,
            //字符字号，默认 14px
            fsize: 14,
            //一个 tab 显示的字符数，默认 4
            tabw: 4,
        },
        gui: {
            dvLogo: 'https://ms.systech.work/src/icon/deskvue-logo${expand}${dark}.svg',
            wallpaper: 'https://qypms.systech.work/wallpaper/dvwp_${dark}.webp',
            //defaultWallpapers: '',
            desktopGridSize: 'medium',
            desktopGridGutter: 16,
            desktopPadding: 16,
            taskbarPosition: 'bottom',
            taskbarSize: 64,
        },
        win: {
            windowTightness: 'compact',
        },
    },
}
export type DvConfigDefine = typeof dvConfig

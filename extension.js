/*
编程伴侣（HBuilderX插件）
版本：0.1.8
作者：ezshine

此插件的创意来源是VSCode的彩虹屁插件(感谢感谢)，兼容彩虹屁插件的语音包。
在本插件中，播放音频采用系统自带的命令，无需打开浏览器。
未来希望扩展为不仅仅只有彩虹屁功能，而是一个真正的编程伴侣。
*/

const hx = require("hbuilderx");

const {
	exec
} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

//用于和live2dPlayer进程通讯的信使
const messenger = require('messenger');
const server = messenger.createListener(32719);
const client = messenger.createSpeaker(32718);

//监听HBuilder Node进程的退出事件，退出时通知live2dPlayer
const process = require('process');
process.on('exit', (code) => {
	client.shout('hbuilderExit');
});

let input_analysis;
let coding_start;
let enabledDebug;
let outputChannel;
let wifeIsReady = false;
//该方法将在插件激活的时候调用
function activate(context) {
	debugLog("好戏开始了：" + Date.now());
	const ostype = os.type;
	debugLog("当前系统为" + ostype);

	//初始化命中历史
	coding_start = Date.now();
	input_analysis = {};

	//注册命令
	setupCommands();

	//获得插件配置
	const pluginConfig = hx.workspace.getConfiguration("codinglover");
	//是否开启虚拟老婆
	enabledDebug = pluginConfig.get("enabledDebug", false);
	//是否开启虚拟老婆
	let enabledLive2d = pluginConfig.get("enabledLive2d", false);
	//虚拟老婆名称
	let live2dPackageName = pluginConfig.get("live2dPackageName", "liang") || "liang";
	
	//调试使用的参数，发布前必须注释掉
	// enabledLive2d = true;
	// enabledDebug = true;
	// live2dPackageName="shizuku";
	
	if (enabledDebug) {
		outputChannel = hx.window.createOutputChannel("编程伴侣");
		outputChannel.show();
	}
	
	//是否禁用彩虹屁
	const disabledRainbowFart = pluginConfig.get("disabledRainbowFart", false);
	//输入监测时间间隔
	const inputDetectInterval = pluginConfig.get("inputDetectInterval", 5000) || 5000;
	//语音包名称
	const voicePackageName = pluginConfig.get("voicePackageName", "default") || "default";

	//检查插件配置
	debugLog("enabledDebug：" + enabledDebug);
	debugLog("enabledLive2d：" + enabledLive2d);
	debugLog("live2dPackageName：" + live2dPackageName);
	debugLog("disabledRainbowFart：" + disabledRainbowFart);
	debugLog("inputDetectInterval：" + inputDetectInterval);
	debugLog("voicePackageName：" + voicePackageName);

	//老婆数据路径
	const lpPath = path.posix.join(__dirname, "live2dpackages", live2dPackageName);
	let lpModelData;
	server.on('wifeContainerReady', function(m, data) {
		debugLog("老婆容器已就绪，容器版本：" + data.v);
		
		if(!fs.existsSync(path.posix.join(lpPath, "model.json"))){
			debugLog("老婆数据包错误：" + path.posix.join(lpPath, "model.json"));
			return;
		}
		
		debugLog("通知容器加载老婆数据：" + lpPath);
		wifeIsReady = true;
		client.shout('loadModel', {
			model: path.posix.join(lpPath, "model.json"),
			commands: [{
				motionfile: "mtn/aoba_live2D_20.mtn",
				text: "哎呀！又翻车了呢！",
				voice: path.posix.join(vpPath, "crash.mp3")
			}],
			sendlog: enabledDebug
		});

		lpModelData = JSON.parse(fs.readFileSync(path.posix.join(lpPath, "model.json")));

		server.on("wifeContainerLog", function(m, data) {
			debugLog("来自老婆容器：" + data);
		});
	});
	//老婆容器路径
	const live2dPlayer = path.posix.join(__dirname, "players", "live2dplayer." + (ostype == "Darwin" ? "app" : "exe"));

	//如果启用老婆
	if (enabledLive2d) {
		//如果老婆容器存在
		if (fs.existsSync(live2dPlayer)) {
			let cmd = (ostype == "Darwin" ? "open" : "start") + " " + live2dPlayer;
			debugLog("执行唤醒老婆容器的命令：" + cmd);
			exec(cmd);
		} else {
			showInformation('没有找到老婆容器：' + live2dPlayer+"<br>请前往https://gitee.com/ezshine/live2dplayer/released下载老婆容器");
		}
	}

	//根据当前系统是window还是macos选择默认的音频播放器
	const mp3Player = (ostype == "Darwin" ? "afplay" : path.posix.join(__dirname, "players", "mp3player.exe"));
	//语音包路径
	const vpPath = path.posix.join(__dirname, "voicepackages", voicePackageName);

	//校验语音包
	if (!fs.existsSync(vpPath)) {
		showInformation('没有找到语音包：' + voicePackageName);
		return;
	}
	if (!fs.existsSync(path.posix.join(vpPath, "contributes.json"))) {
		showInformation('没有找到语音包配置文件(contributes.json)');
		return;
	};
	debugLog('已启用语音包' + voicePackageName);

	//语音包信息
	// const vpInfo = JSON.parse(fs.readFileSync(vpPath + "manifest.json"));
	//语音包配置表
	const vpContributes = JSON.parse(fs.readFileSync(path.posix.join(vpPath, "contributes.json"))).contributes;
	//时间标记名称，用于计算每一个时间标记提醒仅提醒一次
	let voice_mark = "";
	let last_voice_mark = "";
	//上次时间提醒，每隔半小时检查一次时间提醒
	let time_alarm = 0;
	//上次查询的时间戳，用户计算间隔
	let pre = 0;
	//当编辑器中正在输入的时候
	const onDidChangeTextDocumentEventDispose = hx.workspace.onDidChangeTextDocument(function(event) {
		const activeEditor = hx.window.getActiveTextEditor();
		activeEditor.then(function(editor) {
			const linePromise = editor.document.lineFromPosition(editor.selection.active);
			linePromise.then((line) => {
				//当行字符超过50时不做处理
				if (line.length > 50) return;
				parseLine(line.text.trim());
			});
		});
	});

	//重头戏在这里，解析当前行内容并作出相应的反应
	//todo 优化查询性能
	function parseLine(str) {
		const now = new Date();
		if (now - pre < inputDetectInterval) {
			//当两次解析间隔小于输入监测间隔时取消本次处理
			return;
		}
		//重设时间间隔起点
		pre = now;

		//优先时间提醒
		//当上一次的提示不是时间提醒，并且距离上次提醒超过30分钟时才执行时间判断
		if (voice_mark.indexOf("$") < 0 && now - time_alarm > 1800000) {
			time_alarm = now.getTime();
			const hour = now.getHours();
			const minute = now.getMinutes();
			if (minute == 0 && voice_mark != "$time_each_hour") {
				voice_mark = str = "$time_each_hour";
			} else if (hour > 6 && hour <= 9 && voice_mark != "$time_morning") {
				voice_mark = str = "$time_morning";
			} else if (hour >= 11 && hour <= 12 && minute > 30 && voice_mark != "$time_before_noon") {
				voice_mark = str = "$time_before_noon";
			} else if (hour >= 13 && hour <= 15 && voice_mark != "$time_noon") {
				voice_mark = str = "$time_noon";
			} else if (hour >= 20 && hour <= 21 && voice_mark != "$time_evening") {
				voice_mark = str = "$time_evening";
			} else if (hour >= 23 || hour <= 4) {
				voice_mark = str = "$time_midnight";
			}
		}

		let voices = [];
		let hited_item;
		hitkeyword: for (let i = vpContributes.length - 1; i >= 0; i--) {
			const item = vpContributes[i];
			const keywords = item.keywords;
			for (let j = keywords.length - 1; j >= 0; j--) {
				if (str.indexOf(keywords[j]) >= 0) {
					hited_item = item;
					const keyword = keywords[j];
					voice_mark = keyword;
					voices = item.voices;
					break hitkeyword;
				}
			}
		}

		let motions;
		if (wifeIsReady&&lpModelData.contributes) {
			hitkeyword: for (let i = lpModelData.contributes.length - 1; i >= 0; i--) {
				const item = lpModelData.contributes[i];
				const keywords = item.keywords;
				for (let j = keywords.length - 1; j >= 0; j--) {
					if (voice_mark == keywords[j]) {
						motions = item.motions;
						break hitkeyword;
					}
				}
			}
		}

		//命中以及和上次命中结果不一样时才播放，加入彩虹屁开关
		if (voices.length != 0 && last_voice_mark != voice_mark) {
			addInputAnalysis(voice_mark, now);

			let voice_index = Math.floor(Math.random() * voices.length);
			if (!disabledRainbowFart) {
				debugLog("播放音频：" + voice_mark);
				last_voice_mark = voice_mark;

				//音频播放器命令路径，将空格转义
				let playerpath = mp3Player.replace(/ /g, '\\ ');
				let audiopath = path.posix.join(vpPath, voices[voice_index]);
				audiopath = audiopath.replace(/ /g, '\\ ');

				const cmd = playerpath + " " + audiopath;
				debugLog(cmd);
				exec(cmd);
			}

			if (wifeIsReady) {
				//如果老婆容器已就绪，则准备切换老婆动画
				let motionfile;
				if (motions) {
					motionfile = motions[Math.floor(Math.random() * motions.length)];
				}
				showWifeMotion(motionfile);

				//检查彩虹屁是否有台词文本，如果有则显示
				if (hited_item.texts) {
					let text = hited_item.texts[voice_index];
					showWifeTextBubble(text);
				}
			}
		}
	}
}

//统一调试

function debugLog(str) {
	if (enabledDebug) {
		outputChannel.appendLine(str);
	} else {
		console.log(str);
	}
}

//统一通知
function showInformation(msg, title = "编程伴侣") {
	hx.window.showInformationMessage('<span style="color:#3366ff">' + title + '</span><br>' + msg);
}

function showWifeMotion(motionfile) {
	debugLog("切换老婆的动作：" + (motionfile ? motionfile : "随机"));
	client.shout('changeMotion', {
		motionfile: motionfile
	}); //motionfile
}

function showWifeTextBubble(str) {
	debugLog("让老婆显示文字：" + str);
	client.shout('showBubble', {
		content: str
	});
}

function setStatusMsg(msg, autohide = 2000) {
	hx.window.setStatusBarMessage('<span style="color:#3366ff">编程伴侣：</span>' + msg);
}

function setupCommands() {

	let disposable = hx.commands.registerTextEditorCommand('extension.showCodingAnalysis', (editor) => {
		let report_str = "编程时长 " + (Date.now() - coding_start) / 1000 + "秒 <br>";
		for (let item in input_analysis) {
			report_str += item + " 总计：" + input_analysis[item].times + "<br>";
		}
		showInformation(report_str);
	});
}

function addInputAnalysis(keyword, time) {
	if (input_analysis[keyword]) {
		input_analysis[keyword].times += 1;
	} else {
		input_analysis[keyword] = {
			times: 1
		};
	}
}

//该方法将在插件禁用的时候调用（目前是在插件卸载的时候触发）
function deactivate() {

}
module.exports = {
	activate,
	deactivate
}

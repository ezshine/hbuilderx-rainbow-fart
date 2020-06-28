/*
编程伴侣（HBuilderX插件）
版本：0.0.6
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
//该方法将在插件激活的时候调用
function activate(context) {
	console.log("好戏开始了：" + Date.now());
	console.log("当前系统为" + os.type);

	//获得插件配置
	const pluginConfig = hx.workspace.getConfiguration("codinglover");

	//根据当前系统是window还是macos选择默认的音频播放器
	const mp3Player = (os.type == "Darwin" ? "afplay" : path.join(__dirname, "mp3player", "cmdmp3new", "cmdmp3.exe"));

	//输入监测时间间隔
	const inputDetectInterval = pluginConfig.get("inputDetectInterval", 5000) || 5000;
	//语音包名称
	const voicePackageName = pluginConfig.get("voicePackageName", "default") || "default";
	//语音包路径
	const vpPath = path.join(__dirname, "voicepackages", voicePackageName);

	//校验语音包
	if (!fs.existsSync(vpPath)) {
		showInformation('没有找到语音包：' + voicePackageName);
		return;
	}
	if (!fs.existsSync(path.join(vpPath, "contributes.json"))) {
		showInformation('没有找到语音包配置文件(contributes.json)');
		return;
	};
	setStatusMsg('已启用语音包' + voicePackageName);

	//语音包信息
	// const vpInfo = JSON.parse(fs.readFileSync(vpPath + "manifest.json"));
	//语音包配置表
	const vpContributes = JSON.parse(fs.readFileSync(path.join(vpPath, "contributes.json"))).contributes;
	//时间标记名称，用于计算每一个时间标记提醒仅提醒一次
	let voice_mark = "";
	let last_voice_mark = "";
	//上次时间提醒，每隔半小时检查一次时间提醒
	let time_alarm = 0;
	//上次查询的时间戳，用户计算间隔
	let pre = 0;
	//当编辑器中正在输入的时候
	let onDidChangeTextDocumentEventDispose = hx.workspace.onDidChangeTextDocument(function(event) {
		let activeEditor = hx.window.getActiveTextEditor();
		activeEditor.then(function(editor) {
			let linePromise = editor.document.lineFromPosition(editor.selection.active);
			linePromise.then((line) => {
				//当行字符超过50时不做处理
				if (line.length > 50) return;
				let now = Date.now();
				if (now - pre > inputDetectInterval) {
					pre = now;
					parseLine(line.text.trim());
				}
			});
		});
	});

	//重头戏在这里，解析当前行内容并作出相应的反应
	//todo 优化查询性能
	function parseLine(str) {

		//优先时间提醒
		let now = Date.now();
		//当上一次的提示不是时间提醒，并且距离上次提醒超过30分钟时才执行时间判断
		if (voice_mark.indexOf("$") < 0 && now - time_alarm > 1800000) {
			time_alarm = now;
			let hour = new Date().getHours();
			let minute = new Date().getMinutes();
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
		hitkeyword: for (let i = vpContributes.length - 1; i >= 0; i--) {
			let item = vpContributes[i];
			let keywords = item.keywords;
			for (let j = keywords.length - 1; j >= 0; j--) {
				if (str.indexOf(keywords[j]) >= 0) {
					voice_mark = keywords[j];
					voices = item.voices;
					break hitkeyword;
				}
			}
		}

		//命中以及和上次命中结果不一样时才播放
		if (voices.length != 0 && last_voice_mark != voice_mark) {
			console.log("播放音频：" + voice_mark);
			last_voice_mark = voice_mark;
			const cmd = mp3Player + " " + path.join(vpPath, voices[Math.floor(Math.random() * voices.length)]);
			console.log(cmd);
			exec(cmd);
		}
	}
}
//统一通知
function showInformation(msg) {
	hx.window.showInformationMessage('<span style="color:#3366ff">编程伴侣</span><br>' + msg);
}

function setStatusMsg(msg, autohide = 2000) {
	hx.window.setStatusBarMessage('<span style="color:#3366ff">编程伴侣：</span>' + msg);
}

//该方法将在插件禁用的时候调用（目前是在插件卸载的时候触发）
function deactivate() {

}
module.exports = {
	activate,
	deactivate
}

import { initViewer } from './viewer.js';
import { initChat } from './chat.js';

(async () => {
  const viewer = await initViewer(); // VRMビューア初期化
  initChat(viewer);                  // チャット初期化、viewerに連動
})();

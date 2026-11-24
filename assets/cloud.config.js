/* 雲端設定（可公開；publishable key 本來就是給前端用的）
 * 拿掉 url 或加 ?offline=1 就會回到原本的本機示範模式。 */
window.CLOUD_CONFIG = {
  url: "https://zysvrseowwsltkffzrjf.supabase.co",
  key: "sb_publishable_dr1w5oTvPdKGRxOQSChW_Q_f_sqX0gG",
  label: "BPM 檢體管理系統",
};

window.CLOUD_CONFIG.allowOffline = false;
window.CLOUD_ASSET_VER = "202611240908";

// 카카오 개발자 사이트에서 받은 "JavaScript 키"만 넣는다. (REST·Admin 키는 절대 넣지 않음)
// 이 키는 공개돼도 되는 키이고, 카카오 콘솔에 등록한 도메인에서만 동작한다.
window.MATZIP_CONFIG = {
  kakaoJsKey: '3a3559d06218001c65af8af47e2e5fc6',
  // 블로그 글 수 중계 서버 주소(Cloudflare Worker). 비어 있으면 블로그 숫자·언급순 없이 동작
  blogProxy: '',
  // 위치를 못 받았을 때 지도를 둘 곳 (대구시청)
  fallbackCenter: { lat: 35.8714, lng: 128.6014 }
};

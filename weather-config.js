// Public weather-cache endpoint; all QWeather credentials stay in the FC environment.
window.WEATHER_SERVICE_CONFIG={
  endpoint:'https://qinshuither-api-gxfijhrzgc.cn-hongkong.fcapp.run/api/weather',
  fallbackEndpoint:location.protocol==='file:'?'https://kikyo0130yuu-glitch.github.io/qinshui-dashboard/data/weather-latest.json':'data/weather-latest.json',
  intervalMs:300000
};

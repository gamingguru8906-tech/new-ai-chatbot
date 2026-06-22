(function () {
  "use strict";

  if (window.__VESHANN_MAYA_CREDITS_WIDGET__) return;
  window.__VESHANN_MAYA_CREDITS_WIDGET__ = true;

  // widget.js is loaded cross-origin onto veshannastro.co.in from the Render
  // backend (veshannastro-aibot.onrender.com). Every fetch() call below used a
  // bare relative path like "/message" or "/api/gemstone/recommend" -- relative
  // paths in fetch() always resolve against the PAGE's origin, never the
  // script's own origin. So every single call was silently hitting
  // https://veshannastro.co.in/message (which doesn't exist on the static
  // frontend host) instead of the backend, and falling straight into the
  // catch block. This constant fixes that for every endpoint in this file.
  var API_BASE = (function () {
    try {
      var current = document.currentScript && document.currentScript.src;
      if (current) return new URL(current).origin;
    } catch (e) {}
    return "https://veshannastro-aibot.onrender.com";
  })();

  function apiUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return API_BASE + path;
  }

  var state = {
    sessionId: getOrCreateSessionId(),
    mode: "closed",
    credits: readCredits(),
    renewalEtaHours: 24,
    responseCount: 0,
    creditPlan: [],
    gemStep: 0,
    gemLoading: false,
    gemResult: null,
    gemData: { name: "", goal: "", dob: "", tob: "", birth_city: "", birth_lat: null, birth_lon: null, birth_tz: "", whatsapp: "" },
    astroStage: "idle",
    astroStep: 0,
    astroData: { name: "", dob: "", tob: "", birth_city: "", birth_lat: null, birth_lon: null, birth_tz: "" },
    astroOverview: "",
    astroAskPrompt: "",
    chartData: null,
    sending: false
  };
  var placeSearchTimers = {};
  var placeSearchTokens = {};

  var astroSteps = [
    { key: "name", label: "Name", title: "What should Maya call you?", type: "text", placeholder: "Enter your full name" },
    { key: "dob", label: "Date of birth", title: "What is your date of birth?", type: "text", placeholder: "DD/MM/YYYY" },
    { key: "tob", label: "Birth time", title: "Do you know your birth time?", type: "time", placeholder: "" },
    { key: "birth_city", label: "Birth city", title: "Which city were you born in?", type: "text", placeholder: "City, state, country" }
  ];

  var GOAL_OPTIONS = [
    { value: "career_wealth", icon: "\u2605", label: "Career & Wealth", desc: "Growth, opportunities, and financial momentum" },
    { value: "love_relationships", icon: "\u2665", label: "Love & Relationships", desc: "Harmony, connection, and emotional warmth" },
    { value: "health_energy", icon: "\u2600", label: "Health & Energy", desc: "Vitality, stamina, and steady wellbeing" },
    { value: "protection_clarity", icon: "\u26E8", label: "Protection & Clarity", desc: "Shielding from negativity and confusion" },
    { value: "spiritual_growth", icon: "\u262F", label: "Spiritual Growth", desc: "Inner peace, intuition, and higher purpose" }
  ];

  // Self-contained Indian + major international city dataset with verified
  // lat/lon/timezone. Used to drive the birth-city autocomplete so Maya sends
  // precise coordinates to the backend instead of a free-text string -- this is
  // what was silently breaking dasha/transit (see isCityMatch/renderCityField below).
  var CITY_DATA = [{"name":"New Delhi","state":"Delhi","country":"India","lat":28.6139,"lon":77.209,"tz":"Asia/Kolkata"},{"name":"Mumbai","state":"Maharashtra","country":"India","lat":19.076,"lon":72.8777,"tz":"Asia/Kolkata"},{"name":"Bengaluru","state":"Karnataka","country":"India","lat":12.9716,"lon":77.5946,"tz":"Asia/Kolkata"},{"name":"Chennai","state":"Tamil Nadu","country":"India","lat":13.0827,"lon":80.2707,"tz":"Asia/Kolkata"},{"name":"Kolkata","state":"West Bengal","country":"India","lat":22.5726,"lon":88.3639,"tz":"Asia/Kolkata"},{"name":"Hyderabad","state":"Telangana","country":"India","lat":17.385,"lon":78.4867,"tz":"Asia/Kolkata"},{"name":"Pune","state":"Maharashtra","country":"India","lat":18.5204,"lon":73.8567,"tz":"Asia/Kolkata"},{"name":"Ahmedabad","state":"Gujarat","country":"India","lat":23.0225,"lon":72.5714,"tz":"Asia/Kolkata"},{"name":"Surat","state":"Gujarat","country":"India","lat":21.1702,"lon":72.8311,"tz":"Asia/Kolkata"},{"name":"Jaipur","state":"Rajasthan","country":"India","lat":26.9124,"lon":75.7873,"tz":"Asia/Kolkata"},{"name":"Lucknow","state":"Uttar Pradesh","country":"India","lat":26.8467,"lon":80.9462,"tz":"Asia/Kolkata"},{"name":"Kanpur","state":"Uttar Pradesh","country":"India","lat":26.4499,"lon":80.3319,"tz":"Asia/Kolkata"},{"name":"Nagpur","state":"Maharashtra","country":"India","lat":21.1458,"lon":79.0882,"tz":"Asia/Kolkata"},{"name":"Indore","state":"Madhya Pradesh","country":"India","lat":22.7196,"lon":75.8577,"tz":"Asia/Kolkata"},{"name":"Bhopal","state":"Madhya Pradesh","country":"India","lat":23.2599,"lon":77.4126,"tz":"Asia/Kolkata"},{"name":"Patna","state":"Bihar","country":"India","lat":25.5941,"lon":85.1376,"tz":"Asia/Kolkata"},{"name":"Vadodara","state":"Gujarat","country":"India","lat":22.3072,"lon":73.1812,"tz":"Asia/Kolkata"},{"name":"Ghaziabad","state":"Uttar Pradesh","country":"India","lat":28.6692,"lon":77.4538,"tz":"Asia/Kolkata"},{"name":"Ludhiana","state":"Punjab","country":"India","lat":30.901,"lon":75.8573,"tz":"Asia/Kolkata"},{"name":"Agra","state":"Uttar Pradesh","country":"India","lat":27.1767,"lon":78.0081,"tz":"Asia/Kolkata"},{"name":"Nashik","state":"Maharashtra","country":"India","lat":19.9975,"lon":73.7898,"tz":"Asia/Kolkata"},{"name":"Faridabad","state":"Haryana","country":"India","lat":28.4089,"lon":77.3178,"tz":"Asia/Kolkata"},{"name":"Meerut","state":"Uttar Pradesh","country":"India","lat":28.9845,"lon":77.7064,"tz":"Asia/Kolkata"},{"name":"Rajkot","state":"Gujarat","country":"India","lat":22.3039,"lon":70.8022,"tz":"Asia/Kolkata"},{"name":"Varanasi","state":"Uttar Pradesh","country":"India","lat":25.3176,"lon":82.9739,"tz":"Asia/Kolkata"},{"name":"Srinagar","state":"Jammu and Kashmir","country":"India","lat":34.0837,"lon":74.7973,"tz":"Asia/Kolkata"},{"name":"Amritsar","state":"Punjab","country":"India","lat":31.634,"lon":74.8723,"tz":"Asia/Kolkata"},{"name":"Allahabad","state":"Uttar Pradesh","country":"India","lat":25.4358,"lon":81.8463,"tz":"Asia/Kolkata"},{"name":"Prayagraj","state":"Uttar Pradesh","country":"India","lat":25.4358,"lon":81.8463,"tz":"Asia/Kolkata"},{"name":"Ranchi","state":"Jharkhand","country":"India","lat":23.3441,"lon":85.3096,"tz":"Asia/Kolkata"},{"name":"Jabalpur","state":"Madhya Pradesh","country":"India","lat":23.1815,"lon":79.9864,"tz":"Asia/Kolkata"},{"name":"Gwalior","state":"Madhya Pradesh","country":"India","lat":26.2183,"lon":78.1828,"tz":"Asia/Kolkata"},{"name":"Vijayawada","state":"Andhra Pradesh","country":"India","lat":16.5062,"lon":80.648,"tz":"Asia/Kolkata"},{"name":"Jodhpur","state":"Rajasthan","country":"India","lat":26.2389,"lon":73.0243,"tz":"Asia/Kolkata"},{"name":"Madurai","state":"Tamil Nadu","country":"India","lat":9.9252,"lon":78.1198,"tz":"Asia/Kolkata"},{"name":"Raipur","state":"Chhattisgarh","country":"India","lat":21.2514,"lon":81.6296,"tz":"Asia/Kolkata"},{"name":"Bhilai","state":"Chhattisgarh","country":"India","lat":21.1938,"lon":81.3509,"tz":"Asia/Kolkata"},{"name":"Durg","state":"Chhattisgarh","country":"India","lat":21.19,"lon":81.2849,"tz":"Asia/Kolkata"},{"name":"Bilaspur","state":"Chhattisgarh","country":"India","lat":22.0797,"lon":82.1391,"tz":"Asia/Kolkata"},{"name":"Korba","state":"Chhattisgarh","country":"India","lat":22.3595,"lon":82.7501,"tz":"Asia/Kolkata"},{"name":"Kota","state":"Rajasthan","country":"India","lat":25.2138,"lon":75.8648,"tz":"Asia/Kolkata"},{"name":"Chandigarh","state":"Chandigarh","country":"India","lat":30.7333,"lon":76.7794,"tz":"Asia/Kolkata"},{"name":"Guwahati","state":"Assam","country":"India","lat":26.1445,"lon":91.7362,"tz":"Asia/Kolkata"},{"name":"Thiruvananthapuram","state":"Kerala","country":"India","lat":8.5241,"lon":76.9366,"tz":"Asia/Kolkata"},{"name":"Kochi","state":"Kerala","country":"India","lat":9.9312,"lon":76.2673,"tz":"Asia/Kolkata"},{"name":"Kozhikode","state":"Kerala","country":"India","lat":11.2588,"lon":75.7804,"tz":"Asia/Kolkata"},{"name":"Coimbatore","state":"Tamil Nadu","country":"India","lat":11.0168,"lon":76.9558,"tz":"Asia/Kolkata"},{"name":"Tiruchirappalli","state":"Tamil Nadu","country":"India","lat":10.7905,"lon":78.7047,"tz":"Asia/Kolkata"},{"name":"Visakhapatnam","state":"Andhra Pradesh","country":"India","lat":17.6868,"lon":83.2185,"tz":"Asia/Kolkata"},{"name":"Mysuru","state":"Karnataka","country":"India","lat":12.2958,"lon":76.6394,"tz":"Asia/Kolkata"},{"name":"Mangaluru","state":"Karnataka","country":"India","lat":12.9141,"lon":74.856,"tz":"Asia/Kolkata"},{"name":"Hubballi","state":"Karnataka","country":"India","lat":15.3647,"lon":75.124,"tz":"Asia/Kolkata"},{"name":"Belagavi","state":"Karnataka","country":"India","lat":15.8497,"lon":74.4977,"tz":"Asia/Kolkata"},{"name":"Nellore","state":"Andhra Pradesh","country":"India","lat":14.4426,"lon":79.9865,"tz":"Asia/Kolkata"},{"name":"Guntur","state":"Andhra Pradesh","country":"India","lat":16.3067,"lon":80.4365,"tz":"Asia/Kolkata"},{"name":"Warangal","state":"Telangana","country":"India","lat":17.9689,"lon":79.5941,"tz":"Asia/Kolkata"},{"name":"Dehradun","state":"Uttarakhand","country":"India","lat":30.3165,"lon":78.0322,"tz":"Asia/Kolkata"},{"name":"Haridwar","state":"Uttarakhand","country":"India","lat":29.9457,"lon":78.1642,"tz":"Asia/Kolkata"},{"name":"Shimla","state":"Himachal Pradesh","country":"India","lat":31.1048,"lon":77.1734,"tz":"Asia/Kolkata"},{"name":"Jammu","state":"Jammu and Kashmir","country":"India","lat":32.7266,"lon":74.857,"tz":"Asia/Kolkata"},{"name":"Bhubaneswar","state":"Odisha","country":"India","lat":20.2961,"lon":85.8245,"tz":"Asia/Kolkata"},{"name":"Cuttack","state":"Odisha","country":"India","lat":20.4625,"lon":85.883,"tz":"Asia/Kolkata"},{"name":"Patiala","state":"Punjab","country":"India","lat":30.3398,"lon":76.3869,"tz":"Asia/Kolkata"},{"name":"Jalandhar","state":"Punjab","country":"India","lat":31.326,"lon":75.5762,"tz":"Asia/Kolkata"},{"name":"Bathinda","state":"Punjab","country":"India","lat":30.211,"lon":74.9455,"tz":"Asia/Kolkata"},{"name":"Udaipur","state":"Rajasthan","country":"India","lat":24.5854,"lon":73.7125,"tz":"Asia/Kolkata"},{"name":"Ajmer","state":"Rajasthan","country":"India","lat":26.4499,"lon":74.6399,"tz":"Asia/Kolkata"},{"name":"Bikaner","state":"Rajasthan","country":"India","lat":28.0229,"lon":73.3119,"tz":"Asia/Kolkata"},{"name":"Siliguri","state":"West Bengal","country":"India","lat":26.7271,"lon":88.3953,"tz":"Asia/Kolkata"},{"name":"Asansol","state":"West Bengal","country":"India","lat":23.6889,"lon":86.9661,"tz":"Asia/Kolkata"},{"name":"Durgapur","state":"West Bengal","country":"India","lat":23.5204,"lon":87.3119,"tz":"Asia/Kolkata"},{"name":"Howrah","state":"West Bengal","country":"India","lat":22.5958,"lon":88.2636,"tz":"Asia/Kolkata"},{"name":"Aurangabad","state":"Maharashtra","country":"India","lat":19.8762,"lon":75.3433,"tz":"Asia/Kolkata"},{"name":"Solapur","state":"Maharashtra","country":"India","lat":17.6599,"lon":75.9064,"tz":"Asia/Kolkata"},{"name":"Thane","state":"Maharashtra","country":"India","lat":19.2183,"lon":72.9781,"tz":"Asia/Kolkata"},{"name":"Navi Mumbai","state":"Maharashtra","country":"India","lat":19.033,"lon":73.0297,"tz":"Asia/Kolkata"},{"name":"Kalyan","state":"Maharashtra","country":"India","lat":19.2403,"lon":73.1305,"tz":"Asia/Kolkata"},{"name":"Vasai-Virar","state":"Maharashtra","country":"India","lat":19.3919,"lon":72.8397,"tz":"Asia/Kolkata"},{"name":"Rourkela","state":"Odisha","country":"India","lat":22.2604,"lon":84.8536,"tz":"Asia/Kolkata"},{"name":"Gaya","state":"Bihar","country":"India","lat":24.7955,"lon":84.9994,"tz":"Asia/Kolkata"},{"name":"Muzaffarpur","state":"Bihar","country":"India","lat":26.1209,"lon":85.3647,"tz":"Asia/Kolkata"},{"name":"Bhagalpur","state":"Bihar","country":"India","lat":25.2425,"lon":87.0079,"tz":"Asia/Kolkata"},{"name":"Dhanbad","state":"Jharkhand","country":"India","lat":23.7957,"lon":86.4304,"tz":"Asia/Kolkata"},{"name":"Jamshedpur","state":"Jharkhand","country":"India","lat":22.8046,"lon":86.2029,"tz":"Asia/Kolkata"},{"name":"Bokaro","state":"Jharkhand","country":"India","lat":23.6693,"lon":86.1511,"tz":"Asia/Kolkata"},{"name":"Imphal","state":"Manipur","country":"India","lat":24.817,"lon":93.9368,"tz":"Asia/Kolkata"},{"name":"Shillong","state":"Meghalaya","country":"India","lat":25.5788,"lon":91.8933,"tz":"Asia/Kolkata"},{"name":"Aizawl","state":"Mizoram","country":"India","lat":23.7271,"lon":92.7176,"tz":"Asia/Kolkata"},{"name":"Kohima","state":"Nagaland","country":"India","lat":25.6751,"lon":94.1086,"tz":"Asia/Kolkata"},{"name":"Agartala","state":"Tripura","country":"India","lat":23.8315,"lon":91.2868,"tz":"Asia/Kolkata"},{"name":"Gangtok","state":"Sikkim","country":"India","lat":27.3389,"lon":88.6065,"tz":"Asia/Kolkata"},{"name":"Itanagar","state":"Arunachal Pradesh","country":"India","lat":27.0844,"lon":93.6053,"tz":"Asia/Kolkata"},{"name":"Panaji","state":"Goa","country":"India","lat":15.4909,"lon":73.8278,"tz":"Asia/Kolkata"},{"name":"Margao","state":"Goa","country":"India","lat":15.2832,"lon":73.9862,"tz":"Asia/Kolkata"},{"name":"Puducherry","state":"Puducherry","country":"India","lat":11.9416,"lon":79.8083,"tz":"Asia/Kolkata"},{"name":"Port Blair","state":"Andaman and Nicobar Islands","country":"India","lat":11.6234,"lon":92.7265,"tz":"Asia/Kolkata"},{"name":"Noida","state":"Uttar Pradesh","country":"India","lat":28.5355,"lon":77.391,"tz":"Asia/Kolkata"},{"name":"Gurugram","state":"Haryana","country":"India","lat":28.4595,"lon":77.0266,"tz":"Asia/Kolkata"},{"name":"Rohtak","state":"Haryana","country":"India","lat":28.8955,"lon":76.6066,"tz":"Asia/Kolkata"},{"name":"Hisar","state":"Haryana","country":"India","lat":29.1492,"lon":75.7217,"tz":"Asia/Kolkata"},{"name":"Karnal","state":"Haryana","country":"India","lat":29.6857,"lon":76.9905,"tz":"Asia/Kolkata"},{"name":"Panipat","state":"Haryana","country":"India","lat":29.3909,"lon":76.9635,"tz":"Asia/Kolkata"},{"name":"Bareilly","state":"Uttar Pradesh","country":"India","lat":28.367,"lon":79.4304,"tz":"Asia/Kolkata"},{"name":"Aligarh","state":"Uttar Pradesh","country":"India","lat":27.8974,"lon":78.088,"tz":"Asia/Kolkata"},{"name":"Moradabad","state":"Uttar Pradesh","country":"India","lat":28.8389,"lon":78.7378,"tz":"Asia/Kolkata"},{"name":"Saharanpur","state":"Uttar Pradesh","country":"India","lat":29.968,"lon":77.5552,"tz":"Asia/Kolkata"},{"name":"Gorakhpur","state":"Uttar Pradesh","country":"India","lat":26.7606,"lon":83.3732,"tz":"Asia/Kolkata"},{"name":"Jhansi","state":"Uttar Pradesh","country":"India","lat":25.4484,"lon":78.5685,"tz":"Asia/Kolkata"},{"name":"Mathura","state":"Uttar Pradesh","country":"India","lat":27.4924,"lon":77.6737,"tz":"Asia/Kolkata"},{"name":"Ujjain","state":"Madhya Pradesh","country":"India","lat":23.1765,"lon":75.7885,"tz":"Asia/Kolkata"},{"name":"Sagar","state":"Madhya Pradesh","country":"India","lat":23.8388,"lon":78.7378,"tz":"Asia/Kolkata"},{"name":"Satna","state":"Madhya Pradesh","country":"India","lat":24.6005,"lon":80.8322,"tz":"Asia/Kolkata"},{"name":"Rewa","state":"Madhya Pradesh","country":"India","lat":24.5364,"lon":81.3037,"tz":"Asia/Kolkata"},{"name":"Ratlam","state":"Madhya Pradesh","country":"India","lat":23.3315,"lon":75.0367,"tz":"Asia/Kolkata"},{"name":"Rajnandgaon","state":"Chhattisgarh","country":"India","lat":21.0974,"lon":81.0289,"tz":"Asia/Kolkata"},{"name":"Ambikapur","state":"Chhattisgarh","country":"India","lat":23.1167,"lon":83.2,"tz":"Asia/Kolkata"},{"name":"Raigarh","state":"Chhattisgarh","country":"India","lat":21.8974,"lon":83.395,"tz":"Asia/Kolkata"},{"name":"Tirupati","state":"Andhra Pradesh","country":"India","lat":13.6288,"lon":79.4192,"tz":"Asia/Kolkata"},{"name":"Anantapur","state":"Andhra Pradesh","country":"India","lat":14.6819,"lon":77.6006,"tz":"Asia/Kolkata"},{"name":"Kurnool","state":"Andhra Pradesh","country":"India","lat":15.8281,"lon":78.0373,"tz":"Asia/Kolkata"},{"name":"Karimnagar","state":"Telangana","country":"India","lat":18.4386,"lon":79.1288,"tz":"Asia/Kolkata"},{"name":"Nizamabad","state":"Telangana","country":"India","lat":18.6725,"lon":78.0941,"tz":"Asia/Kolkata"},{"name":"Salem","state":"Tamil Nadu","country":"India","lat":11.6643,"lon":78.146,"tz":"Asia/Kolkata"},{"name":"Erode","state":"Tamil Nadu","country":"India","lat":11.341,"lon":77.7172,"tz":"Asia/Kolkata"},{"name":"Tirunelveli","state":"Tamil Nadu","country":"India","lat":8.7139,"lon":77.7567,"tz":"Asia/Kolkata"},{"name":"Vellore","state":"Tamil Nadu","country":"India","lat":12.9165,"lon":79.1325,"tz":"Asia/Kolkata"},{"name":"Thrissur","state":"Kerala","country":"India","lat":10.5276,"lon":76.2144,"tz":"Asia/Kolkata"},{"name":"Kollam","state":"Kerala","country":"India","lat":8.8932,"lon":76.6141,"tz":"Asia/Kolkata"},{"name":"Alappuzha","state":"Kerala","country":"India","lat":9.4981,"lon":76.3388,"tz":"Asia/Kolkata"},{"name":"London","state":"England","country":"United Kingdom","lat":51.5072,"lon":-0.1276,"tz":"Europe/London"},{"name":"New York","state":"New York","country":"United States","lat":40.7128,"lon":-74.006,"tz":"America/New_York"},{"name":"Los Angeles","state":"California","country":"United States","lat":34.0522,"lon":-118.2437,"tz":"America/Los_Angeles"},{"name":"Toronto","state":"Ontario","country":"Canada","lat":43.6532,"lon":-79.3832,"tz":"America/Toronto"},{"name":"Dubai","state":"Dubai","country":"United Arab Emirates","lat":25.2048,"lon":55.2708,"tz":"Asia/Dubai"},{"name":"Abu Dhabi","state":"Abu Dhabi","country":"United Arab Emirates","lat":24.4539,"lon":54.3773,"tz":"Asia/Dubai"},{"name":"Singapore","state":"Singapore","country":"Singapore","lat":1.3521,"lon":103.8198,"tz":"Asia/Singapore"},{"name":"Sydney","state":"New South Wales","country":"Australia","lat":-33.8688,"lon":151.2093,"tz":"Australia/Sydney"},{"name":"Melbourne","state":"Victoria","country":"Australia","lat":-37.8136,"lon":144.9631,"tz":"Australia/Melbourne"},{"name":"Kuala Lumpur","state":"Kuala Lumpur","country":"Malaysia","lat":3.139,"lon":101.6869,"tz":"Asia/Kuala_Lumpur"},{"name":"Doha","state":"Doha","country":"Qatar","lat":25.2854,"lon":51.531,"tz":"Asia/Qatar"},{"name":"Muscat","state":"Muscat","country":"Oman","lat":23.588,"lon":58.3829,"tz":"Asia/Muscat"},{"name":"Riyadh","state":"Riyadh","country":"Saudi Arabia","lat":24.7136,"lon":46.6753,"tz":"Asia/Riyadh"},{"name":"Kathmandu","state":"Bagmati","country":"Nepal","lat":27.7172,"lon":85.324,"tz":"Asia/Kathmandu"},{"name":"Dhaka","state":"Dhaka","country":"Bangladesh","lat":23.8103,"lon":90.4125,"tz":"Asia/Dhaka"},{"name":"Colombo","state":"Western","country":"Sri Lanka","lat":6.9271,"lon":79.8612,"tz":"Asia/Colombo"}];

  var gemSteps = [
    { key: "name", label: "Name", title: "What should Maya call you?", type: "text", placeholder: "Enter your full name" },
    { key: "goal", label: "Your focus for the year", title: "What's your main focus for the next year?", type: "choice", options: GOAL_OPTIONS },
    { key: "dob", label: "Date of birth", title: "What is your date of birth?", type: "text", placeholder: "DD/MM/YYYY" },
    { key: "tob", label: "Birth time", title: "Do you know your birth time?", type: "time", placeholder: "" },
    { key: "birth_city", label: "Birth city", title: "Which city were you born in?", type: "text", placeholder: "City, state, country" },
    { key: "whatsapp", label: "WhatsApp", title: "Where should Maya send your result?", type: "tel", placeholder: "Enter WhatsApp number" }
  ];

  var fallbackMap = {
    1: ["citrine-tiger-eye", "Citrine + Tiger Eye Bracelet", "Sun support for confidence, vitality, and personal authority."],
    2: ["rose-quartz-moonstone", "Rose Quartz + Moonstone Bracelet", "Moon support for emotional calm and inner balance."],
    3: ["citrine-yellow-aventurine", "Citrine + Yellow Aventurine Bracelet", "Jupiter support for growth, wisdom, and expansion."],
    4: ["triple-protection-amethyst", "Triple Protection + Amethyst Bracelet", "Rahu-style protection for clarity and aura cleansing."],
    5: ["green-aventurine-lapis-lazuli", "Green Aventurine + Lapis Lazuli Bracelet", "Mercury support for communication and practical clarity."],
    6: ["rose-quartz-green-aventurine", "Rose Quartz + Green Aventurine Bracelet", "Venus support for love, harmony, and heart healing."],
    7: ["amethyst-clear-quartz", "Amethyst + Clear Quartz Bracelet", "Ketu-style support for spiritual clarity and grounding."],
    8: ["black-tourmaline-blue-sapphire-substitute", "Black Tourmaline + Blue Sapphire Substitute Bracelet", "Saturn support for discipline, grounding, and pressure protection."],
    9: ["red-jasper-tiger-eye", "Red Jasper + Tiger Eye Bracelet", "Mars support for courage, stamina, and controlled action."]
  };

  function readCredits() {
    var stored = Number(localStorage.getItem("mayaCredits") || "300");
    return Number.isFinite(stored) && stored >= 0 ? stored : 300;
  }

  function getOrCreateSessionId() {
    // Previously this was "maya-" + Date.now(), regenerated on every page
    // load -- meaning the backend's "Welcome back" returning-user path and
    // any server-persisted credits or chart data were orphaned on every
    // single visit, since each load looked like a brand new visitor to the
    // database. Persisting it makes the visitor's identity stable.
    try {
      var existing = localStorage.getItem("mayaSessionId");
      if (existing) return existing;
      var fresh = "maya-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("mayaSessionId", fresh);
      return fresh;
    } catch (e) {
      return "maya-" + Date.now();
    }
  }

  function saveCredits() {
    localStorage.setItem("mayaCredits", String(Math.max(0, Math.round(state.credits))));
  }

  function makeCreditPlan() {
    var first = 82 + Math.floor(Math.random() * 28);
    var second = 86 + Math.floor(Math.random() * 26);
    var third = 300 - first - second;
    if (third < 70) {
      third = 78;
      second = 300 - first - third;
    }
    return [first, second, third];
  }

  function nextCreditUse() {
    if (!state.creditPlan.length || state.responseCount % 3 === 0) state.creditPlan = makeCreditPlan();
    return state.creditPlan[state.responseCount % 3] || 100;
  }

  function deductCredits(amount) {
    state.credits = Math.max(0, state.credits - amount);
    state.responseCount += 1;
    saveCredits();
  }

  function addCredits(amount) {
    state.credits = Number(state.credits || 0) + Number(amount || 0);
    saveCredits();
  }

  function creditsText() {
    return Math.max(0, Math.round(state.credits)) + " Maya credits";
  }

  function syncCredits(data) {
    if (!data) return;
    if (typeof data.credits_after === "number") state.credits = Math.max(0, data.credits_after);
    else if (typeof data.credits === "number") state.credits = Math.max(0, data.credits);
    else if (data.credit_status && typeof data.credit_status.credits === "number") state.credits = Math.max(0, data.credit_status.credits);
    if (data.credit_status && typeof data.credit_status.renewal_eta_hours === "number") {
      state.renewalEtaHours = data.credit_status.renewal_eta_hours;
    } else if (typeof data.renewal_eta_hours === "number") {
      state.renewalEtaHours = data.renewal_eta_hours;
    } else if (!state.renewalEtaHours) {
      state.renewalEtaHours = 24;
    }
    saveCredits();
  }

  function newMessageId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "msg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  function formatBotText(text) {
    var safe = escapeHtml(text || "");
    safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return safe.replace(/\n/g, "<br>");
  }

  function timelineHtml(text) {
    var matches = String(text || "").match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\s+20\d{2}\b/g) || [];
    var unique = [];
    matches.forEach(function (item) { if (unique.indexOf(item) === -1) unique.push(item); });
    if (!unique.length) return "";
    return '<div class="maya-timeline"><div class="maya-mini-title">Timing window</div>' +
      unique.slice(0, 4).map(function (item, index) {
        return '<div class="maya-time-row"><span>' + (index + 1) + '</span><b>' + escapeHtml(item) + '</b></div>';
      }).join("") + '</div>';
  }

  function searchCities(query) {
    var q = String(query || "").trim().toLowerCase();
    if (q.length < 2) return [];
    var starts = [];
    var contains = [];
    for (var i = 0; i < CITY_DATA.length; i += 1) {
      var c = CITY_DATA[i];
      var name = c.name.toLowerCase();
      var label = [c.name, c.state, c.country].join(" ").toLowerCase();
      if (name.indexOf(q) === 0) starts.push(c);
      else if (label.indexOf(q) !== -1) contains.push(c);
    }
    return starts.concat(contains).slice(0, 7);
  }

  function cityDisplayLabel(c) {
    return [c.name, c.state, c.country].filter(Boolean).join(", ");
  }

  function renderCitySuggestions(query, opts) {
    opts = opts || {};
    var target = opts.target || state.gemData;
    var listId = opts.listId || "mayaCityList";
    var statusId = opts.statusId || "mayaCityStatus";
    var inputId = opts.inputId || "mayaGemInput";
    var list = document.getElementById(listId);
    var status = document.getElementById(statusId);
    if (!list) return;
    var matches = searchCities(query);
    if (!matches.length) {
      list.classList.remove("is-open");
      list.innerHTML = "";
      if (status) status.innerHTML = query
        ? '<div class="maya-city-unconfirmed">Pick your city from the list for exact coordinates. Without this, Maya falls back to estimating your city, which can affect dasha and transit accuracy.</div>'
        : "";
      return;
    }
    list.innerHTML = matches.map(function (c, idx) {
      return '<button type="button" class="maya-city-option" data-city-index="' + idx + '"><strong>' + escapeHtml(c.name) + '</strong><small>' + escapeHtml(c.state + ", " + c.country) + '</small></button>';
    }).join("");
    list.classList.add("is-open");
    var options = list.querySelectorAll("[data-city-index]");
    for (var i = 0; i < options.length; i += 1) {
      options[i].addEventListener("click", function (event) {
        var idx = Number(event.currentTarget.getAttribute("data-city-index"));
        var city = matches[idx];
        var input = document.getElementById(inputId);
        var label = cityDisplayLabel(city);
        input.value = label;
        target.birth_city = label;
        target.birth_lat = city.lat;
        target.birth_lon = city.lon;
        target.birth_tz = city.tz;
        list.classList.remove("is-open");
        if (status) status.innerHTML = '<div class="maya-city-confirmed">\u2713 Exact coordinates confirmed -- Maya will use these for your chart.</div>';
        input.focus();
      });
    }
    if (status && !opts.keepStatus) status.innerHTML = "";
  }

  function schedulePlaceSearch(query, opts, timerKey) {
    var q = String(query || "").trim();
    clearTimeout(placeSearchTimers[timerKey]);
    if (q.length < 3) return;
    placeSearchTimers[timerKey] = setTimeout(function () {
      searchGlobalPlaces(q, opts);
    }, 650);
  }

  async function searchGlobalPlaces(query, opts) {
    opts = opts || {};
    var target = opts.target || state.astroData;
    var listId = opts.listId || "mayaAstroCityList";
    var statusId = opts.statusId || "mayaAstroCityStatus";
    var inputId = opts.inputId || "mayaAstroInput";
    var tokenKey = opts.tokenKey || listId;
    var list = document.getElementById(listId);
    var status = document.getElementById(statusId);
    var q = String(query || "").trim();
    var token = String(Date.now()) + Math.random();
    placeSearchTokens[tokenKey] = token;
    if (!list || q.length < 3) {
      if (status) status.innerHTML = '<div class="maya-city-unconfirmed">Type at least 3 letters to search your place.</div>';
      return;
    }
    var localMatches = searchCities(q);
    if (localMatches.length) {
      var localOpts = {};
      Object.keys(opts).forEach(function (key) { localOpts[key] = opts[key]; });
      localOpts.keepStatus = true;
      renderCitySuggestions(q, localOpts);
    } else {
      list.innerHTML = "";
      list.classList.remove("is-open");
    }
    if (status) status.innerHTML = '<div class="maya-city-confirmed">Searching worldwide places...</div>';
    try {
      var data = await getJson("/api/places?q=" + encodeURIComponent(q));
      if (placeSearchTokens[tokenKey] !== token) return;
      var places = data.places || [];
      if (!places.length) {
        if (localMatches.length) {
          if (status) status.innerHTML = '<div class="maya-city-confirmed">Select one of the shown matches, or type city + country for a wider search.</div>';
        } else if (status) {
          status.innerHTML = '<div class="maya-city-unconfirmed">No place found. Try city + state/country, for example "Bhopal India" or "Paris France".</div>';
        }
        return;
      }
      list.innerHTML = places.map(function (place, idx) {
        var source = place.source ? " · " + place.source : "";
        return '<button type="button" class="maya-city-option" data-place-index="' + idx + '"><strong>' + escapeHtml(place.name || place.label) + '</strong><small>' + escapeHtml((place.label || "") + source) + '</small></button>';
      }).join("");
      list.classList.add("is-open");
      var options = list.querySelectorAll("[data-place-index]");
      for (var i = 0; i < options.length; i += 1) {
        options[i].addEventListener("click", function (event) {
          var idx = Number(event.currentTarget.getAttribute("data-place-index"));
          var place = places[idx];
          var input = document.getElementById(inputId);
          var label = place.label || place.name;
          input.value = label;
          target.birth_city = label;
          target.birth_lat = place.lat;
          target.birth_lon = place.lon;
          target.birth_tz = place.tz || "UTC";
          list.classList.remove("is-open");
          if (status) status.innerHTML = '<div class="maya-city-confirmed">Exact place selected. Chart will use these coordinates.</div>';
          input.focus();
        });
      }
      if (status) status.innerHTML = '<div class="maya-city-confirmed">Select your exact birth place from the list.</div>';
    } catch (error) {
      if (placeSearchTokens[tokenKey] !== token) return;
      if (localMatches.length) {
        if (status) status.innerHTML = '<div class="maya-city-confirmed">Showing saved matches. For a smaller town, add state and country, then search again.</div>';
      } else if (status) {
        status.innerHTML = '<div class="maya-city-unconfirmed">Place search is slow right now. Add state/country and try again.</div>';
      }
    }
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char];
    });
  }

  function toIndianDate(isoDate) {
    var parts = String(isoDate || "").split("-");
    if (parts.length !== 3) return "";
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function dobForApi(value) {
    var raw = String(value || "").trim();
    var indian = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (indian) {
      var day = indian[1].padStart(2, "0");
      var month = indian[2].padStart(2, "0");
      return indian[3] + "-" + month + "-" + day;
    }
    return raw;
  }

  function isValidIndianDob(value) {
    var iso = dobForApi(value);
    var match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    // Build the date in UTC and read it back in UTC. Using new Date(iso + "T00:00:00")
    // (no offset) constructs the date in the BROWSER's local timezone, then comparing
    // against .toISOString() (always UTC) rolls the date back a day for any timezone
    // ahead of UTC -- e.g. IST midnight becomes 18:30 UTC the previous day. That was
    // silently rejecting every correctly-formatted Indian date of birth.
    var date = new Date(Date.UTC(year, month - 1, day));
    var today = new Date();
    if (date.getTime() > today.getTime()) return false;
    return date.getUTCFullYear() === year &&
      (date.getUTCMonth() + 1) === month &&
      date.getUTCDate() === day;
  }

  function normaliseTime(value) {
    var raw = String(value || "").trim().replace(/\s+/g, " ");
    if (!raw) return "";
    var standard = raw.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    var ampm = raw.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)$/i);
    var hour;
    var minute;
    if (ampm) {
      hour = Number(ampm[1]);
      minute = ampm[2] ? Number(ampm[2]) : 0;
      if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return "";
      var suffix = ampm[3].toLowerCase();
      if (suffix === "pm" && hour < 12) hour += 12;
      if (suffix === "am" && hour === 12) hour = 0;
    } else if (standard) {
      hour = Number(standard[1]);
      minute = standard[2] ? Number(standard[2]) : 0;
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
    } else {
      return "";
    }
    return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
  }

  function injectStyles() {
    if (document.getElementById("maya-credits-widget-style")) return;
    var style = document.createElement("style");
    style.id = "maya-credits-widget-style";
    style.textContent = [
      ".maya-launcher{position:fixed;right:22px;bottom:22px;z-index:2147482500;border:0;border-radius:999px;padding:14px 18px;background:#211913;color:#fff8e9;box-shadow:0 18px 44px rgba(20,15,11,.28);font-weight:800;cursor:pointer}",
      ".maya-overlay{position:fixed;inset:0;z-index:2147482501;display:none;align-items:center;justify-content:center;padding:22px;background:rgba(20,15,11,.46);backdrop-filter:blur(14px)}.maya-overlay.is-open{display:flex}",
      ".maya-box{width:min(760px,calc(100vw - 30px));max-height:calc(100svh - 34px);overflow:auto;background:#f8efe0;color:#241c15;border:1px solid rgba(185,142,61,.44);border-radius:24px;box-shadow:0 32px 100px rgba(18,13,9,.42)}",
      ".maya-head{min-height:88px;padding:18px 22px;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;background:linear-gradient(135deg,#241c15,#4a321e);border-bottom:1px solid rgba(231,194,105,.42)}",
      ".maya-brand{display:flex;gap:14px;align-items:center}.maya-orb{width:54px;height:54px;border-radius:999px;background:radial-gradient(circle at 35% 30%,#fff2ad,#d9ae3e 68%,#9f7425);box-shadow:0 12px 28px rgba(217,174,62,.26)}.maya-brand h3{margin:0;color:#f4d377;font:700 22px Georgia,serif;letter-spacing:.08em}.maya-brand p{margin:4px 0 0;color:rgba(255,248,233,.74);font-size:14px}",
      ".maya-close{width:48px;height:48px;border:0;border-radius:14px;background:#d9ae3e;color:#241c15;font-size:26px;font-weight:900;cursor:pointer}",
      ".maya-content{padding:22px}.maya-kicker{color:#956b24;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.maya-title{margin:7px 0 10px;color:#241c15;font:600 clamp(26px,3vw,38px)/1.07 Georgia,serif}.maya-copy{margin:0 0 18px;color:#614b35;font-size:14px;line-height:1.55}",
      ".maya-choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.maya-choice-card{min-height:176px;padding:19px;display:grid;align-content:start;gap:10px;background:#fffaf1;color:#241c15;border:1px solid rgba(146,104,43,.26);border-radius:18px;box-shadow:0 18px 38px rgba(70,47,24,.1);text-align:left;cursor:pointer}.maya-choice-card strong{font:600 22px/1.13 Georgia,serif;color:#241c15}.maya-choice-card span{color:#614b35;font-size:14px;line-height:1.45}",
      ".maya-panel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147482502;width:min(720px,calc(100vw - 30px));height:min(760px,calc(100svh - 34px));display:none;grid-template-rows:auto minmax(0,1fr) auto;background:#f8efe0;border:1px solid rgba(185,142,61,.44);border-radius:24px;box-shadow:0 32px 100px rgba(18,13,9,.42);overflow:hidden}.maya-panel.is-open{display:grid}",
      ".maya-body{padding:18px;overflow:auto;background:linear-gradient(#fffaf1,#f8efe0)}.maya-foot{display:flex;gap:10px;padding:14px;border-top:1px solid rgba(146,104,43,.22);background:#f8efe0}.maya-input{flex:1;min-height:48px;padding:0 14px;background:#fffdf7;color:#241c15;border:1px solid rgba(146,104,43,.32);border-radius:14px;font-size:15px}.maya-send,.maya-primary{min-height:46px;padding:0 18px;border:0;border-radius:999px;background:#251d16;color:#fff8e9;font-weight:900;cursor:pointer}.maya-secondary{min-height:46px;padding:0 16px;border:1px solid rgba(146,104,43,.24);border-radius:999px;background:#efe0c7;color:#3a2b1d;font-weight:900;cursor:pointer}",
      ".maya-msg{max-width:82%;margin:0 0 12px;padding:12px 14px;border-radius:14px;font-size:15px;line-height:1.5}.maya-bot{background:#fffdf7;color:#2a2119;border:1px solid rgba(146,104,43,.18)}.maya-user{margin-left:auto;background:#30251c;color:#fff8e9}",
      ".maya-credit-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 14px;padding:10px 12px;background:#f7ead6;border:1px solid rgba(146,104,43,.22);border-radius:14px;color:#3a2b1d;font-size:13px;font-weight:900}.maya-credit-bar span{color:#956b24}.maya-upgrade{margin:12px 0 0;padding:14px;background:#fffaf1;border:1px solid rgba(146,104,43,.24);border-radius:16px;color:#3a2b1d}.maya-upgrade p{margin:0 0 10px;color:#614b35;line-height:1.5}.maya-pay{min-height:44px;padding:0 16px;border:0;border-radius:999px;background:#176f46;color:#fffaf0;font-weight:900;cursor:pointer}",
      ".maya-progress{height:7px;margin:12px 0 18px;overflow:hidden;background:#eadcc5;border-radius:999px}.maya-progress span{display:block;height:100%;background:linear-gradient(90deg,#b78325,#efcc72);border-radius:999px}.maya-field{display:grid;gap:8px}.maya-field label{color:#4f3c2a;font-size:12px;font-weight:900;text-transform:uppercase}.maya-field input{min-height:52px;padding:0 14px;background:#fbf3e7;color:#211a14;border:1px solid rgba(146,104,43,.32);border-radius:14px;font-size:16px}",
      ".maya-field-wrap{position:relative;display:grid}.maya-field-wrap input{padding-right:56px}.maya-icon-button{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:40px;height:40px;display:grid;place-items:center;border:1px solid rgba(146,104,43,.24);border-radius:12px;background:#fffaf1;color:#3a2b1d;font-size:18px;font-weight:900;cursor:pointer}.maya-hidden-picker{position:absolute;right:8px;top:50%;width:40px;height:40px;opacity:0;pointer-events:none}.maya-field-hint{color:#7a6248;font-size:12px;line-height:1.4}.maya-field-error{display:none;margin-top:8px;padding:9px 11px;background:#fff0e8;color:#7b2d1c;border:1px solid rgba(123,45,28,.18);border-radius:12px;font-size:13px;line-height:1.4}.maya-field-error.is-visible{display:block}",
      ".maya-report{display:grid;gap:14px}.maya-remedy{padding:15px;background:#fffdf7;border:1px solid rgba(146,104,43,.25);border-left:5px solid #d3a83d;border-radius:16px;box-shadow:0 16px 34px rgba(70,47,24,.1)}.maya-remedy h4{margin:0 0 8px;color:#211a14;font:600 20px Georgia,serif}.maya-remedy p{margin:0 0 9px;color:#5d4935;font-size:13px;line-height:1.5}.maya-remedy a{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;background:#251d16;color:#fff8e9;border-radius:999px;text-decoration:none;font-weight:900}.maya-disclaimer{padding:12px;background:#f7ead6;color:#5d4935;border-radius:14px;font-size:12px;line-height:1.5}.maya-whatsapp{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 18px;background:#176f46;color:#fffaf0;border-radius:999px;text-decoration:none;font-weight:900}",
      ".maya-kundli-card{margin:0 0 14px;padding:14px;background:#fffdf7;border:1px solid rgba(146,104,43,.22);border-radius:18px;box-shadow:0 16px 34px rgba(70,47,24,.1)}.maya-kundli-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}.maya-kundli-top h4{margin:0;color:#241c15;font:600 20px/1.1 Georgia,serif}.maya-kundli-top p{margin:4px 0 0;color:#6b5239;font-size:12.5px;line-height:1.35}.maya-kundli-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.maya-house{min-height:66px;padding:7px;background:#fbf3e7;border:1px solid rgba(146,104,43,.22);border-radius:12px;display:grid;align-content:space-between}.maya-house b{color:#8b6224;font-size:11px}.maya-house span{color:#211a14;font-size:12px;font-weight:800}.maya-house small{color:#6b5239;font-size:11px;line-height:1.25}.maya-chip-row{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}.maya-chip{padding:7px 9px;background:#f7ead6;color:#4f3c2a;border:1px solid rgba(146,104,43,.18);border-radius:999px;font-size:11.5px;font-weight:800}.maya-accordion{display:grid;gap:8px;margin:0 0 14px}.maya-accordion details{background:#fffaf1;border:1px solid rgba(146,104,43,.18);border-radius:12px;padding:10px 12px}.maya-accordion summary{cursor:pointer;color:#3a2b1d;font-weight:900;font-size:13px}.maya-accordion p{margin:8px 0 0;color:#695039;font-size:12.5px;line-height:1.45}.maya-timeline{margin-top:10px;padding:10px;background:#f7ead6;border:1px solid rgba(146,104,43,.16);border-radius:12px}.maya-mini-title{font-size:11px;font-weight:900;text-transform:uppercase;color:#956b24;margin-bottom:7px}.maya-time-row{display:flex;align-items:center;gap:8px;margin-top:5px;color:#3a2b1d;font-size:12px}.maya-time-row span{width:20px;height:20px;display:grid;place-items:center;border-radius:999px;background:#251d16;color:#fff8e9;font-size:10px}.maya-credit-note{max-width:82%;margin:0 0 12px;padding:9px 12px;background:#f7ead6;border:1px solid rgba(146,104,43,.18);border-radius:12px;color:#5b452f;font-size:12.5px;font-weight:800}.maya-typing{display:inline-flex;gap:4px}.maya-typing i{width:6px;height:6px;border-radius:999px;background:#9a722d;animation:mayaBlink 1s infinite ease-in-out}.maya-typing i:nth-child(2){animation-delay:.16s}.maya-typing i:nth-child(3){animation-delay:.32s}@keyframes mayaBlink{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}",
      ".maya-kundli-card--reference{padding:0;background:transparent;border:0;box-shadow:none}.maya-kundli-svg{width:100%;max-width:512px;display:block;margin:0 auto;background:transparent}.maya-kundli-outer{fill:#fffbd4;stroke:#ffad00;stroke-width:8;stroke-linejoin:round}.maya-kundli-inner-border{fill:none;stroke:#ff1b14;stroke-width:3;stroke-linejoin:round}.maya-kundli-line{fill:none;stroke:#ff1b14;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}.maya-kundli-house{font-family:Georgia,'Times New Roman',serif;text-anchor:middle;fill:#c8102e;font-size:20px;font-weight:800}.maya-kundli-sign{font-family:Arial,system-ui,sans-serif;text-anchor:middle;fill:#16120f;font-size:13px;font-weight:800}.maya-kundli-planets{font-family:Arial,system-ui,sans-serif;text-anchor:middle;fill:#241c15;font-size:12px;font-weight:900}",
      "@keyframes mayaStepIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}.maya-step-anim{animation:mayaStepIn .38s cubic-bezier(.22,.61,.36,1)}",
      ".maya-progress span{transition:width .45s cubic-bezier(.22,.61,.36,1)}",
      ".maya-choice-card{transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}.maya-choice-card:hover{transform:translateY(-2px);box-shadow:0 22px 46px rgba(70,47,24,.16)}.maya-choice-card:active{transform:translateY(0)}",
      ".maya-choice-grid--goal{grid-template-columns:1fr}.maya-choice-card--goal{min-height:0;padding:15px 17px;display:flex;align-items:center;gap:14px;position:relative}.maya-choice-card--goal .maya-goal-icon{width:38px;height:38px;flex-shrink:0;border-radius:999px;display:grid;place-items:center;font-size:18px;background:radial-gradient(circle at 35% 30%,#fff2ad,#d9ae3e 68%,#9f7425);color:#241c15}.maya-choice-card--goal .maya-goal-text{display:grid;gap:2px}.maya-choice-card--goal strong{font:600 16px/1.2 Georgia,serif}.maya-choice-card--goal span{font-size:12.5px}.maya-choice-card--goal.is-selected{border-color:#b78325;background:#fff3da;box-shadow:0 0 0 2px rgba(183,131,37,.35),0 18px 38px rgba(70,47,24,.14)}.maya-choice-card--goal.is-selected::after{content:'\\2713';position:absolute;right:14px;top:50%;transform:translateY(-50%);width:24px;height:24px;border-radius:999px;background:#176f46;color:#fffaf0;display:grid;place-items:center;font-size:13px;font-weight:900}",
      ".maya-city-wrap{position:relative}.maya-city-list{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:5;background:#fffaf1;border:1px solid rgba(146,104,43,.3);border-radius:14px;box-shadow:0 22px 50px rgba(70,47,24,.2);max-height:260px;overflow:auto;display:none}.maya-city-list.is-open{display:block}.maya-city-option{display:flex;flex-direction:column;gap:1px;width:100%;text-align:left;padding:11px 14px;border:0;border-bottom:1px solid rgba(146,104,43,.12);background:transparent;cursor:pointer;font-family:inherit}.maya-city-option:last-child{border-bottom:0}.maya-city-option:hover,.maya-city-option.is-active{background:#fff3da}.maya-city-option strong{font-size:14px;color:#241c15;font-weight:700}.maya-city-option small{font-size:12px;color:#7a6248}.maya-city-confirmed{display:flex;align-items:center;gap:8px;margin-top:8px;padding:8px 12px;background:#eaf3de;border:1px solid rgba(39,80,10,.2);border-radius:12px;color:#27500a;font-size:12.5px;font-weight:700}.maya-city-unconfirmed{display:flex;align-items:center;gap:8px;margin-top:8px;padding:8px 12px;background:#fff0e8;border:1px solid rgba(123,45,28,.18);border-radius:12px;color:#7b2d1c;font-size:12.5px;line-height:1.45}",
      "@media(max-width:720px){.maya-choice-grid{grid-template-columns:1fr}.maya-panel{width:100vw;height:100svh;border-radius:0}.maya-box{width:calc(100vw - 20px)}.maya-launcher{right:14px;bottom:14px}.maya-msg{max-width:92%}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function createWidget() {
    injectStyles();
    var root = document.createElement("div");
    root.id = "mayaCreditsWidget";
    root.innerHTML = [
      '<button class="maya-launcher" type="button" data-maya-open>Talk to Maya</button>',
      '<div class="maya-overlay" id="mayaChoice"><div class="maya-box">',
      '<div class="maya-head"><div class="maya-brand"><div class="maya-orb"></div><div><h3>MAYA</h3><p>Veshannastro AI Guide</p></div></div><button class="maya-close" type="button" data-maya-close>×</button></div>',
      '<div class="maya-content"><div class="maya-kicker">Choose your Maya path</div><div class="maya-title">What would you like Maya to prepare?</div><p class="maya-copy">Select one guidance path. The practical astrologer stays separate from the gemstone recommendation tool.</p>',
      '<div class="maya-choice-grid"><button class="maya-choice-card" type="button" data-maya-mode="gemstone"><strong>Gemstone Bracelet Recommendation</strong><span>Free remedy-style bracelet suggestions using your birth details.</span></button><button class="maya-choice-card" type="button" data-maya-mode="astrologer"><strong>Practical AI Astrologer</strong><span>Share what you want to understand about yourself and let Maya read deeper.</span></button></div>',
      '</div></div></div>',
      '<section class="maya-panel" id="mayaPanel"><div class="maya-head"><div class="maya-brand"><div class="maya-orb"></div><div><h3>MAYA</h3><p>Veshannastro AI Guide</p></div></div><button class="maya-close" type="button" data-maya-close>×</button></div><div class="maya-body" id="mayaBody"></div><form class="maya-foot" id="mayaChatFoot"><input class="maya-input" id="mayaChatInput" placeholder="Share what you want Maya to read..." autocomplete="off"><button class="maya-send" type="submit">Send</button></form></section>'
    ].join("");
    document.body.appendChild(root);
  }

  function openChoice() {
    document.getElementById("mayaPanel").classList.remove("is-open");
    document.getElementById("mayaChoice").classList.add("is-open");
  }

  function closeAll() {
    document.getElementById("mayaChoice").classList.remove("is-open");
    document.getElementById("mayaPanel").classList.remove("is-open");
  }

  function openPanel() {
    document.getElementById("mayaChoice").classList.remove("is-open");
    document.getElementById("mayaPanel").classList.add("is-open");
  }

  function addMessage(text, who) {
    var body = document.getElementById("mayaBody");
    var node = document.createElement("div");
    node.className = "maya-msg " + (who === "user" ? "maya-user" : "maya-bot");
    if (who === "user") node.textContent = text;
    else node.innerHTML = formatBotText(text) + timelineHtml(text);
    body.appendChild(node);
    body.scrollTop = body.scrollHeight;
    return node;
  }

  function creditBarHtml() {
    var eta = Math.max(1, Math.round(Number(state.renewalEtaHours || 24)));
    return '<div class="maya-credit-bar"><div>Credits left</div><span>' + escapeHtml(creditsText()) + ' · renews in ' + eta + ' hrs</span></div>';
  }

  function renderCreditBar() {
    var body = document.getElementById("mayaBody");
    var existing = body.querySelector(".maya-credit-bar");
    if (existing) existing.outerHTML = creditBarHtml();
    else body.insertAdjacentHTML("afterbegin", creditBarHtml());
  }

  function renderKundliCard(chart) {
    if (!chart || !chart.houses) return "";
    var romans = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI", 7: "VII", 8: "VIII", 9: "IX", 10: "X", 11: "XI", 12: "XII" };
    var signNums = { Ar: 1, Ta: 2, Ge: 3, Ca: 4, Le: 5, Vi: 6, Li: 7, Sc: 8, Sa: 9, Cp: 10, Aq: 11, Pi: 12 };
    function houseText(num) {
      var h = chart.houses[String(num)] || chart.houses[num] || {};
      var sign = h.sign || "";
      var signNum = h.sign_num || h.signNumber || signNums[sign] || "";
      var planets = Array.isArray(h.planets) ? h.planets : [];
      return { sign: sign, signNum: signNum, planets: planets };
    }
    function planetLines(planets, xy) {
      if (!planets.length) return "";
      var lines = [];
      var current = "";
      planets.forEach(function (planet) {
        var next = current ? current + " " + planet : planet;
        if (next.length > 12 && current) {
          lines.push(current);
          current = planet;
        } else {
          current = next;
        }
      });
      if (current) lines.push(current);
      return lines.slice(0, 2).map(function (line, idx) {
        return '<text class="maya-kundli-planets" x="' + xy[0] + '" y="' + (xy[1] + idx * 14) + '">' + escapeHtml(line) + '</text>';
      }).join("");
    }
    var houseCoords = {
      1: [256, 93], 2: [147, 67], 3: [72, 122], 4: [170, 176],
      5: [72, 258], 6: [150, 335], 7: [256, 314], 8: [362, 335],
      9: [440, 258], 10: [342, 176], 11: [440, 122], 12: [365, 67]
    };
    var planetCoords = {
      1: [256, 120], 2: [147, 88], 3: [72, 145], 4: [170, 199],
      5: [72, 280], 6: [150, 355], 7: [256, 338], 8: [362, 355],
      9: [440, 280], 10: [342, 199], 11: [440, 145], 12: [365, 88]
    };
    var signCoords = {
      1: [256, 182], 2: [178, 103], 3: [128, 119], 4: [210, 188],
      5: [148, 256], 6: [178, 272], 7: [256, 207], 8: [335, 272],
      9: [363, 256], 10: [302, 188], 11: [386, 119], 12: [335, 103]
    };
    var labels = "";
    for (var i = 1; i <= 12; i += 1) {
      var t = houseText(i);
      var hxy = houseCoords[i];
      var pxy = planetCoords[i];
      var sxy = signCoords[i];
      labels += '<text class="maya-kundli-house" x="' + hxy[0] + '" y="' + hxy[1] + '">' + romans[i] + '</text>';
      labels += planetLines(t.planets, pxy);
      if (t.signNum) labels += '<text class="maya-kundli-sign" x="' + sxy[0] + '" y="' + sxy[1] + '">' + escapeHtml(String(t.signNum)) + '</text>';
    }
    var outline = "M256 10 C246 36 215 27 177 29 C139 31 101 29 68 30 C50 30 45 42 37 45 C23 48 25 73 25 109 L25 151 C25 176 8 189 5 192 C8 195 25 208 25 233 L25 275 C25 311 23 336 37 339 C45 342 50 354 68 354 C101 355 139 353 177 355 C215 357 246 348 256 374 C266 348 297 357 335 355 C373 353 411 355 444 354 C462 354 467 342 475 339 C489 336 487 311 487 275 L487 233 C487 208 504 195 507 192 C504 189 487 176 487 151 L487 109 C487 73 489 48 475 45 C467 42 462 30 444 30 C411 29 373 31 335 29 C297 27 266 36 256 10 Z";
    var svg = '<svg class="maya-kundli-svg" viewBox="0 0 512 384" role="img" aria-label="North Indian style Kundli">' +
      '<path class="maya-kundli-outer" d="' + outline + '"></path>' +
      '<path class="maya-kundli-inner-border" d="' + outline + '"></path>' +
      '<path class="maya-kundli-line" d="M256 12 L128 105 L256 192 L384 105 Z"></path>' +
      '<path class="maya-kundli-line" d="M128 105 L5 192 L128 279 L256 192 Z"></path>' +
      '<path class="maya-kundli-line" d="M384 105 L507 192 L384 279 L256 192 Z"></path>' +
      '<path class="maya-kundli-line" d="M128 279 L256 372 L384 279 L256 192 Z"></path>' +
      '<path class="maya-kundli-line" d="M34 42 L128 105 M478 42 L384 105 M34 342 L128 279 M478 342 L384 279"></path>' +
      labels +
      '</svg>';
    return '<section class="maya-kundli-card maya-kundli-card--reference">' +
      svg +
      '</section>';
  }

  function renderAstroAccordions() {
    return '<div class="maya-accordion">' +
      '<details open><summary>D1 Promise</summary><p>Main answer D1 Lagna, house lordship, karaka aur yogas ko combine karke diya jayega.</p></details>' +
      '<details><summary>D9 / D10 Confirmation</summary><p>Marriage questions mein D9 Navamsa, career questions mein D10 Dashamsha confirmation use hoga.</p></details>' +
      '<details><summary>Dasha + Transit</summary><p>Timing ke liye Mahadasha, Antardasha, Pratyantardasha, Gochar aur Ashtakavarga support check hoga.</p></details>' +
      '<details><summary>Remedies</summary><p>Remedy sirf tab di jayegi jab chart mein relevant weak ya afflicted planet clearly dikhe.</p></details>' +
      '</div>';
  }

  function renderChartIntro(chart) {
    var body = document.getElementById("mayaBody");
    var html = renderKundliCard(chart);
    if (html) body.insertAdjacentHTML("beforeend", html);
  }

  function showTyping() {
    var body = document.getElementById("mayaBody");
    var node = document.createElement("div");
    node.className = "maya-msg maya-bot";
    node.innerHTML = '<span class="maya-typing"><i></i><i></i><i></i></span>';
    body.appendChild(node);
    body.scrollTop = body.scrollHeight;
    return node;
  }

  function showUpgradePrompt() {
    var body = document.getElementById("mayaBody");
    var old = body.querySelector(".maya-upgrade");
    if (old) old.remove();
    body.insertAdjacentHTML("beforeend", '<div class="maya-upgrade"><p><strong>Want Maya to reveal more layers?</strong><br>Let’s stay connected and explore more about you. Unlock another 300 Maya credits for just ₹99.</p><button class="maya-pay" type="button" id="mayaBuyCredits">Unlock 300 credits for ₹99</button></div>');
    var button = document.getElementById("mayaBuyCredits");
    if (button) button.addEventListener("click", buyCredits);
    body.scrollTop = body.scrollHeight;
  }

  function loadRazorpayCheckout() {
    return new Promise(function (resolve, reject) {
      if (window.Razorpay) return resolve();
      var script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = resolve;
      script.onerror = function () { reject(new Error("Razorpay checkout could not load")); };
      document.head.appendChild(script);
    });
  }

  async function postJson(paths, payload) {
    var lastError = null;
    for (var i = 0; i < paths.length; i += 1) {
      try {
        var response = await fetch(apiUrl(paths[i]), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        var text = await response.text();
        var data = text ? JSON.parse(text) : {};
        if (response.ok && data.ok !== false) return data;
        lastError = new Error(data.error || data.message || (data.ok === false && data.reply) || "Request failed");
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Connection issue");
  }

  async function getJson(path) {
    var response = await fetch(apiUrl(path), { method: "GET" });
    var text = await response.text();
    var data = text ? JSON.parse(text) : {};
    if (!response.ok || data.ok === false) throw new Error(data.error || data.detail || "Request failed");
    return data;
  }

  async function buyCredits() {
    var button = document.getElementById("mayaBuyCredits");
    if (button) {
      button.disabled = true;
      button.textContent = "Opening secure payment...";
    }
    try {
      await loadRazorpayCheckout();
      var order = await postJson(["/api/credits/create-order"], { session_id: state.sessionId, credits: 300, amount: 99 });
      var options = {
        key: order.key_id,
        amount: order.amount,
        currency: order.currency || "INR",
        name: "Veshannastro",
        description: "300 Maya Credits",
        order_id: order.order_id,
        theme: { color: "#d9ae3e" },
        handler: async function (response) {
          try {
            var verified = await postJson(["/api/credits/verify"], {
              session_id: state.sessionId,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            });
            syncCredits(verified);
            renderCreditBar();
            addMessage("Payment verify ho gaya. 300 credits add ho gaye hain, ab hum reading continue kar sakte hain.", "bot");
          } catch (error) {
            addMessage("Payment was received by Razorpay, but Maya could not verify it here. Please contact support with your payment ID.", "bot");
          }
        },
        modal: {
          ondismiss: function () {
            if (button) {
              button.disabled = false;
              button.textContent = "Unlock 300 credits for ₹99";
            }
          }
        }
      };
      new window.Razorpay(options).open();
    } catch (error) {
      addMessage("Payment setup is not ready yet. Please try again after the Razorpay backend keys are configured.", "bot");
      if (button) {
        button.disabled = false;
        button.textContent = "Unlock 300 credits for ₹99";
      }
    }
  }

  function showUpgradePrompt() {
    var body = document.getElementById("mayaBody");
    var old = body.querySelector(".maya-upgrade");
    if (old) old.remove();
    body.insertAdjacentHTML("beforeend", '<div class="maya-upgrade"><p><strong>Your 300 credits are used.</strong><br>Recharge for &#8377;99 to continue chatting with AI Astrologer.</p><button class="maya-pay" type="button" id="mayaBuyCredits">Recharge 300 credits for &#8377;99</button></div>');
    var button = document.getElementById("mayaBuyCredits");
    if (button) button.addEventListener("click", buyCredits);
    body.scrollTop = body.scrollHeight;
  }

  function openAstrologer() {
    state.mode = "astrologer";
    document.getElementById("mayaChatFoot").style.display = "none";
    openPanel();
    checkAstroStart();
  }

  async function checkAstroStart() {
    state.astroStage = "loading";
    document.getElementById("mayaBody").innerHTML = '<div class="maya-step-anim"><div class="maya-kicker">Maya is getting ready</div><div class="maya-title">One moment...</div><div class="maya-progress"><span style="width:60%"></span></div></div>';
    try {
      var data = await postJson(["/api/start"], { session_id: state.sessionId });
      if (data.stage === "ready") {
        state.astroStage = "ready";
        syncCredits(data);
        state.chartData = data.chart_data || null;
        document.getElementById("mayaChatFoot").style.display = "flex";
        document.getElementById("mayaBody").innerHTML = creditBarHtml();
        renderChartIntro(state.chartData);
        addMessage(data.reply || "Welcome back! Ask me anything about your day, love, career, or money.", "bot");
        if (state.credits <= 0) showUpgradePrompt();
      } else {
        state.astroStage = "setup";
        state.astroStep = 0;
        renderAstroSetup();
      }
    } catch (error) {
      // Backend unreachable for /api/start -- degrade to direct chat rather than
      // stranding the user on a spinner. sendChat's own error handling covers
      // the case where the backend stays unreachable.
      state.astroStage = "ready";
      document.getElementById("mayaChatFoot").style.display = "flex";
      document.getElementById("mayaBody").innerHTML = creditBarHtml();
      addMessage("Namaste, I am Maya. You have " + creditsText() + " to begin. Share what you want to understand about yourself, and I will read it with emotional depth, practical clarity, and spiritual care.", "bot");
      if (state.credits <= 0) showUpgradePrompt();
    }
  }

  function renderAstroSetup() {
    var body = document.getElementById("mayaBody");
    var foot = document.getElementById("mayaChatFoot");
    foot.style.display = "none";
    var step = astroSteps[state.astroStep];
    var percent = Math.round(((state.astroStep + 1) / astroSteps.length) * 100);
    var fieldValue = state.astroData[step.key] || "";
    var fieldHtml;

    if (step.key === "birth_city") {
      var hasCoords = state.astroData.birth_lat !== null && state.astroData.birth_lon !== null && state.astroData.birth_city === fieldValue;
      var statusHtml = hasCoords
        ? '<div class="maya-city-confirmed">Exact place selected. Chart will use these coordinates.</div>'
        : (fieldValue ? '<div class="maya-city-unconfirmed">Searching places... select your exact match.</div>' : '');
      fieldHtml = [
        '<div class="maya-field"><label>Birth city</label>',
        '<div class="maya-city-wrap">',
        '<div class="maya-field-wrap">',
        '<input id="mayaAstroInput" type="text" autocomplete="off" value="' + escapeHtml(fieldValue) + '" placeholder="City, state, country">',
        '<button class="maya-icon-button" type="button" id="mayaAstroPlaceSearch" aria-label="Search place">&#128269;</button>',
        '</div>',
        '<div class="maya-city-list" id="mayaAstroCityList"></div>',
        '</div>',
        '<div class="maya-field-hint">Type city, state, country. Select the exact place from the list.</div>',
        '<div id="mayaAstroCityStatus">' + statusHtml + '</div>',
        '</div>'
      ].join("");
    } else if (step.key === "dob") {
      fieldHtml = [
        '<div class="maya-field"><label>Date of birth</label>',
        '<div class="maya-field-wrap">',
        '<input id="mayaAstroInput" type="text" inputmode="numeric" value="' + escapeHtml(fieldValue) + '" placeholder="DD/MM/YYYY">',
        '<button class="maya-icon-button" type="button" id="mayaAstroDateButton" aria-label="Open date picker">&#9638;</button>',
        '<input class="maya-hidden-picker" id="mayaAstroNativeDate" type="date" tabindex="-1">',
        '</div><div class="maya-field-hint">Use Indian format: DD/MM/YYYY</div></div>'
      ].join("");
    } else if (step.key === "tob") {
      fieldHtml = [
        '<div class="maya-field"><label>Birth time</label>',
        '<div class="maya-field-wrap">',
        '<input id="mayaAstroInput" type="text" inputmode="numeric" value="' + escapeHtml(fieldValue) + '" placeholder="HH:MM or 07:30 PM">',
        '<button class="maya-icon-button" type="button" id="mayaAstroTimeButton" aria-label="Open time picker">&#9719;</button>',
        '<input class="maya-hidden-picker" id="mayaAstroNativeTime" type="time" tabindex="-1">',
        '</div><div class="maya-field-hint">Use the clock icon, or type time manually. Unknown time is also okay.</div></div>'
      ].join("");
    } else {
      fieldHtml = '<div class="maya-field"><label>' + escapeHtml(step.label) + '</label><input id="mayaAstroInput" type="' + step.type + '" value="' + escapeHtml(fieldValue) + '" placeholder="' + escapeHtml(step.placeholder) + '"></div>';
    }

    body.innerHTML = [
      '<div class="maya-step-anim">',
      '<div class="maya-kicker">Step ' + (state.astroStep + 1) + ' of ' + astroSteps.length + '</div>',
      '<div class="maya-title">' + escapeHtml(step.title) + '</div>',
      '<p class="maya-copy">' + (step.key === "tob" ? "If you do not know it, use the button below. Maya will safely use noon fallback." : "Maya needs this to calculate your real Vedic chart -- dasha, transits, and house placements.") + '</p>',
      '<div class="maya-progress"><span style="width:' + percent + '%"></span></div>',
      fieldHtml,
      '<div class="maya-field-error" id="mayaAstroFieldError"></div>',
      '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px">',
      state.astroStep ? '<button class="maya-secondary" type="button" id="astroBack">Back</button>' : "",
      step.key === "tob" ? '<button class="maya-secondary" type="button" id="astroUnknown">Time of birth unknown</button>' : "",
      '<button class="maya-primary" type="button" id="astroNext">' + (state.astroStep === astroSteps.length - 1 ? "Start my reading" : "Continue") + '</button>',
      '</div>',
      '</div>'
    ].join("");

    var input = document.getElementById("mayaAstroInput");
    input.focus();
    input.addEventListener("input", function () {
      state.astroData[step.key] = input.value;
      if (step.key === "birth_city") {
        state.astroData.birth_lat = null;
        state.astroData.birth_lon = null;
        state.astroData.birth_tz = "";
        var status = document.getElementById("mayaAstroCityStatus");
        var list = document.getElementById("mayaAstroCityList");
        if (list) {
          list.innerHTML = "";
          list.classList.remove("is-open");
        }
        if (status) status.innerHTML = input.value.trim().length >= 3
          ? '<div class="maya-city-unconfirmed">Searching places... select your exact match.</div>'
          : '';
        schedulePlaceSearch(input.value, { target: state.astroData, listId: "mayaAstroCityList", statusId: "mayaAstroCityStatus", inputId: "mayaAstroInput", tokenKey: "astroPlace" }, "astroPlace");
      }
    });
    input.addEventListener("keydown", function (event) {
      if (step.key === "birth_city" && event.key === "Enter") {
        event.preventDefault();
        searchGlobalPlaces(input.value, { target: state.astroData, listId: "mayaAstroCityList", statusId: "mayaAstroCityStatus", inputId: "mayaAstroInput", tokenKey: "astroPlace" });
      }
    });

    var dateButton = document.getElementById("mayaAstroDateButton");
    var nativeDate = document.getElementById("mayaAstroNativeDate");
    if (dateButton && nativeDate) {
      dateButton.addEventListener("click", function () {
        if (nativeDate.showPicker) nativeDate.showPicker();
        else nativeDate.click();
      });
      nativeDate.addEventListener("change", function () {
        state.astroData.dob = toIndianDate(nativeDate.value);
        input.value = state.astroData.dob;
      });
    }
    var timeButton = document.getElementById("mayaAstroTimeButton");
    var nativeTime = document.getElementById("mayaAstroNativeTime");
    if (timeButton && nativeTime) {
      timeButton.addEventListener("click", function () {
        if (nativeTime.showPicker) nativeTime.showPicker();
        else nativeTime.click();
      });
      nativeTime.addEventListener("change", function () {
        state.astroData.tob = nativeTime.value;
        input.value = state.astroData.tob;
      });
    }
    if (step.key === "birth_city") {
      var placeSearch = document.getElementById("mayaAstroPlaceSearch");
      if (placeSearch) placeSearch.addEventListener("click", function () {
        searchGlobalPlaces(input.value, { target: state.astroData, listId: "mayaAstroCityList", statusId: "mayaAstroCityStatus", inputId: "mayaAstroInput", tokenKey: "astroPlace" });
      });
      document.addEventListener("click", function closeAstroCityList(event) {
        var list = document.getElementById("mayaAstroCityList");
        if (list && !event.target.closest(".maya-city-wrap")) list.classList.remove("is-open");
      });
    }
    var back = document.getElementById("astroBack");
    if (back) back.addEventListener("click", function () { state.astroStep = Math.max(0, state.astroStep - 1); renderAstroSetup(); });
    var unknown = document.getElementById("astroUnknown");
    if (unknown) unknown.addEventListener("click", function () { state.astroData.tob = "12:00"; state.astroStep += 1; renderAstroSetup(); });
    document.getElementById("astroNext").addEventListener("click", function () {
      state.astroData[step.key] = input.value;
      if (step.key !== "tob" && !String(input.value || "").trim()) {
        input.focus();
        return;
      }
      if (step.key === "dob" && !isValidIndianDob(input.value)) {
        var error = document.getElementById("mayaAstroFieldError");
        if (error) {
          error.textContent = "Please enter date of birth in DD/MM/YYYY format, or use the calendar icon.";
          error.classList.add("is-visible");
        }
        input.focus();
        return;
      }
      if (step.key === "birth_city" && (state.astroData.birth_lat === null || state.astroData.birth_lon === null)) {
        var cityError = document.getElementById("mayaAstroFieldError");
        if (cityError) {
          cityError.textContent = "Please select your exact birth place from the list.";
          cityError.classList.add("is-visible");
        }
        input.focus();
        return;
      }
      if (step.key === "tob") {
        var parsedTime = normaliseTime(input.value);
        if (!parsedTime) {
          var timeError = document.getElementById("mayaAstroFieldError");
          if (timeError) {
            timeError.textContent = "Please select time using the clock icon, or type like 14:35 / 2:35 PM.";
            timeError.classList.add("is-visible");
          }
          input.focus();
          return;
        }
        state.astroData.tob = parsedTime;
      }
      if (state.astroStep === astroSteps.length - 1) submitAstroSetup();
      else {
        state.astroStep += 1;
        renderAstroSetup();
      }
    });
  }

  async function submitAstroSetup() {
    document.getElementById("mayaBody").innerHTML = '<div class="maya-step-anim"><div class="maya-kicker">Maya is reading your chart</div><div class="maya-title">Calculating your Vedic chart...</div><p class="maya-copy">Dasha, transits, and house placements -- this takes a moment.</p><div class="maya-progress"><span style="width:85%"></span></div></div>';
    try {
      var data = await postJson(["/api/setup"], {
        session_id: state.sessionId,
        name: state.astroData.name,
        dob: dobForApi(state.astroData.dob),
        tob: normaliseTime(state.astroData.tob) || "12:00",
        place: state.astroData.birth_city,
        latitude: state.astroData.birth_lat,
        longitude: state.astroData.birth_lon,
        timezone: state.astroData.birth_tz || null
      });
      state.astroStage = "ready";
      syncCredits(data);
      state.chartData = data.chart_data || null;
      document.getElementById("mayaChatFoot").style.display = "flex";
      document.getElementById("mayaBody").innerHTML = creditBarHtml();
      renderChartIntro(state.chartData);
      addMessage(data.reply || "Here is your birth chart.", "bot");
      if (data.overview) addMessage(data.overview, "bot");
      addMessage(data.ask_prompt || "Ask me a specific question, or say 'Give me a full reading' for a comprehensive analysis.", "bot");
      if (state.credits <= 0) showUpgradePrompt();
    } catch (error) {
      state.astroStep = astroSteps.length - 1;
      renderAstroSetup();
      var fieldError = document.getElementById("mayaAstroFieldError");
      if (fieldError) {
        fieldError.textContent = (error && error.message) || "Maya could not read that chart. Please check your birth details and try again.";
        fieldError.classList.add("is-visible");
      }
    }
  }

  async function sendChat(text) {
    if (state.sending) return;
    if (state.astroStage !== "ready") {
      addMessage(text, "user");
      addMessage("Let's set up your birth details first so Maya can read your real chart.", "bot");
      state.astroStage = "setup";
      state.astroStep = 0;
      renderAstroSetup();
      return;
    }
    if (state.credits <= 0) {
      addMessage("Your current Maya credits are complete. I can continue deeper once you unlock more credits.", "bot");
      showUpgradePrompt();
      return;
    }
    state.sending = true;
    addMessage(text, "user");
    var typing = showTyping();
    try {
      var data = await postJson(["/api/message"], { session_id: state.sessionId, message: text, client_message_id: newMessageId() });
      if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
      syncCredits(data);
      renderCreditBar();
      addMessage(data.reply || data.message || data.response || "Maya is here with you. There is more beneath this pattern than it first appears, and we can explore it layer by layer.", "bot");
      if (data.locked) {
        showUpgradePrompt();
      } else if (state.credits <= 0) {
        showUpgradePrompt();
      }
    } catch (error) {
      if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
      addMessage("Connection issue with Maya right now. Please try again in a moment.", "bot");
    } finally {
      state.sending = false;
    }
  }

  function digitalRoot(value) {
    var digits = String(value || "").replace(/\D/g, "").split("");
    var total = digits.reduce(function (sum, d) { return sum + Number(d || 0); }, 0);
    while (total > 9) total = String(total).split("").reduce(function (sum, d) { return sum + Number(d || 0); }, 0);
    return total || 4;
  }

  function fallbackGemstoneResult(reason) {
    var primary = fallbackMap[digitalRoot(state.gemData.dob)] || fallbackMap[4];
    var start = new Date();
    var end = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
    var period = start.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) + " to " + end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    function card(item) {
      return { product_id: item[0], name: item[1], why: item[2], dasha_gochar_reason: reason || "Exact chart service was unavailable, so Maya used safe DOB fallback.", best_period: period, wearing_instruction: "Wear on your receptive wrist after a short morning prayer or sankalp.", price: "Contact for price", product_url: "/bracelets?ref=maya&id=" + item[0] };
    }
    return { message: "Maya prepared a safe DOB-based remedy report from the available bracelet mapping.", recommendations: [card(primary), card(["seven-chakra-black-tourmaline", "7 Chakra + Black Tourmaline Bracelet", "General protection support for grounding, cleansing, and aura balance."])], final_remedy: "Final remedy: Roz subah 2 minute shant baithkar apne Isht Dev ka naam 11 baar lein, phir bracelet ko sankalp ke saath pehnen.", disclaimer: "Gemstone bracelets are spiritual/remedial support and are not a guaranteed replacement for medical, financial, legal, or professional advice." };
  }

  function renderGemstone() {
    var body = document.getElementById("mayaBody");
    var foot = document.getElementById("mayaChatFoot");
    foot.style.display = "none";
    if (state.gemLoading) {
      body.innerHTML = '<div class="maya-step-anim"><div class="maya-kicker">Maya is preparing your report</div><div class="maya-title">Reading your remedy path...</div><p class="maya-copy">This usually takes a moment.</p><div class="maya-progress"><span style="width:82%"></span></div></div>';
      return;
    }
    if (state.gemResult) {
      renderReport();
      return;
    }
    var step = gemSteps[state.gemStep];
    var percent = Math.round(((state.gemStep + 1) / gemSteps.length) * 100);

    if (step.type === "choice") {
      var selected = state.gemData[step.key] || "";
      var cardsHtml = step.options.map(function (opt) {
        var isSel = opt.value === selected ? " is-selected" : "";
        return '<button class="maya-choice-card maya-choice-card--goal' + isSel + '" type="button" data-goal-value="' + escapeHtml(opt.value) + '">' +
          '<span class="maya-goal-icon">' + opt.icon + '</span>' +
          '<span class="maya-goal-text"><strong>' + escapeHtml(opt.label) + '</strong><span>' + escapeHtml(opt.desc) + '</span></span>' +
          '</button>';
      }).join("");
      body.innerHTML = [
        '<div class="maya-step-anim">',
        '<div class="maya-kicker">Step ' + (state.gemStep + 1) + ' of ' + gemSteps.length + '</div>',
        '<div class="maya-title">' + escapeHtml(step.title) + '</div>',
        '<p class="maya-copy">Maya will weight your bracelet recommendation toward this focus, alongside your birth details.</p>',
        '<div class="maya-progress"><span style="width:' + percent + '%"></span></div>',
        '<div class="maya-choice-grid maya-choice-grid--goal">' + cardsHtml + '</div>',
        '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px">',
        state.gemStep ? '<button class="maya-secondary" type="button" id="gemBack">Back</button>' : "",
        '<button class="maya-secondary" type="button" id="gemSkipGoal">Skip this</button>',
        '</div>',
        '</div>'
      ].join("");
      var goalCards = body.querySelectorAll("[data-goal-value]");
      for (var gi = 0; gi < goalCards.length; gi += 1) {
        goalCards[gi].addEventListener("click", function (event) {
          state.gemData.goal = event.currentTarget.getAttribute("data-goal-value");
          state.gemStep += 1;
          renderGemstone();
        });
      }
      var skipGoal = document.getElementById("gemSkipGoal");
      if (skipGoal) skipGoal.addEventListener("click", function () {
        state.gemData.goal = "";
        state.gemStep += 1;
        renderGemstone();
      });
      var backGoal = document.getElementById("gemBack");
      if (backGoal) backGoal.addEventListener("click", function () { state.gemStep = Math.max(0, state.gemStep - 1); renderGemstone(); });
      return;
    }

    var fieldValue = state.gemData[step.key] || "";
    var fieldHtml = '<div class="maya-field"><label>' + escapeHtml(step.label) + '</label><input id="mayaGemInput" type="' + step.type + '" value="' + escapeHtml(fieldValue) + '" placeholder="' + escapeHtml(step.placeholder) + '"></div>';
    if (step.key === "dob") {
      fieldHtml = [
        '<div class="maya-field"><label>Date of birth</label>',
        '<div class="maya-field-wrap">',
        '<input id="mayaGemInput" type="text" inputmode="numeric" value="' + escapeHtml(fieldValue) + '" placeholder="DD/MM/YYYY">',
        '<button class="maya-icon-button" type="button" id="mayaDateButton" aria-label="Open date picker">&#9638;</button>',
        '<input class="maya-hidden-picker" id="mayaNativeDate" type="date" tabindex="-1">',
        '</div><div class="maya-field-hint">Use Indian format: DD/MM/YYYY</div></div>'
      ].join("");
    }
    if (step.key === "tob") {
      fieldHtml = [
        '<div class="maya-field"><label>Birth time</label>',
        '<div class="maya-field-wrap">',
        '<input id="mayaGemInput" type="text" inputmode="numeric" value="' + escapeHtml(fieldValue) + '" placeholder="HH:MM or 07:30 PM">',
        '<button class="maya-icon-button" type="button" id="mayaTimeButton" aria-label="Open time picker">&#9719;</button>',
        '<input class="maya-hidden-picker" id="mayaNativeTime" type="time" tabindex="-1">',
        '</div><div class="maya-field-hint">Use the clock icon, or type time manually. Unknown time is also okay.</div></div>'
      ].join("");
    }
    if (step.key === "birth_city") {
      var hasCoords = state.gemData.birth_lat !== null && state.gemData.birth_lon !== null && state.gemData.birth_city === fieldValue;
      var statusHtml = hasCoords
        ? '<div class="maya-city-confirmed">Exact place selected. Chart will use these coordinates.</div>'
        : (fieldValue ? '<div class="maya-city-unconfirmed">Searching places... select your exact match.</div>' : '');
      fieldHtml = [
        '<div class="maya-field"><label>Birth city</label>',
        '<div class="maya-city-wrap">',
        '<div class="maya-field-wrap">',
        '<input id="mayaGemInput" type="text" autocomplete="off" value="' + escapeHtml(fieldValue) + '" placeholder="City, state, country">',
        '<button class="maya-icon-button" type="button" id="mayaGemPlaceSearch" aria-label="Search place">&#128269;</button>',
        '</div>',
        '<div class="maya-city-list" id="mayaCityList"></div>',
        '</div>',
        '<div class="maya-field-hint">Type city, state, country. Select the exact place from the list.</div>',
        '<div id="mayaCityStatus">' + statusHtml + '</div>',
        '</div>'
      ].join("");
    }
    body.innerHTML = [
      '<div class="maya-step-anim">',
      '<div class="maya-kicker">Step ' + (state.gemStep + 1) + ' of ' + gemSteps.length + '</div>',
      '<div class="maya-title">' + escapeHtml(step.title) + '</div>',
      '<p class="maya-copy">' + (step.key === "tob" ? "If you do not know it, use the button below. Maya will safely use noon fallback." : "This helps Maya prepare a more personal bracelet recommendation.") + '</p>',
      '<div class="maya-progress"><span style="width:' + percent + '%"></span></div>',
      fieldHtml,
      '<div class="maya-field-error" id="mayaFieldError"></div>',
      '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px">',
      state.gemStep ? '<button class="maya-secondary" type="button" id="gemBack">Back</button>' : "",
      step.key === "tob" ? '<button class="maya-secondary" type="button" id="gemUnknown">Time of birth unknown</button>' : "",
      '<button class="maya-primary" type="button" id="gemNext">' + (state.gemStep === gemSteps.length - 1 ? "Prepare my remedy report" : "Continue") + '</button>',
      '</div>',
      '</div>'
    ].join("");
    var input = document.getElementById("mayaGemInput");
    input.focus();
    input.addEventListener("input", function () {
      state.gemData[step.key] = input.value;
      if (step.key === "birth_city") {
        // Any manual retyping invalidates a previously-confirmed coordinate match
        // until the user picks a fresh suggestion.
        state.gemData.birth_lat = null;
        state.gemData.birth_lon = null;
        state.gemData.birth_tz = "";
        var status = document.getElementById("mayaCityStatus");
        var list = document.getElementById("mayaCityList");
        if (list) {
          list.innerHTML = "";
          list.classList.remove("is-open");
        }
        if (status) status.innerHTML = input.value.trim().length >= 3
          ? '<div class="maya-city-unconfirmed">Searching places... select your exact match.</div>'
          : '';
        schedulePlaceSearch(input.value, { target: state.gemData, listId: "mayaCityList", statusId: "mayaCityStatus", inputId: "mayaGemInput", tokenKey: "gemPlace" }, "gemPlace");
      }
    });
    input.addEventListener("keydown", function (event) {
      if (step.key === "birth_city" && event.key === "Enter") {
        event.preventDefault();
        searchGlobalPlaces(input.value, { target: state.gemData, listId: "mayaCityList", statusId: "mayaCityStatus", inputId: "mayaGemInput", tokenKey: "gemPlace" });
      }
    });
    var dateButton = document.getElementById("mayaDateButton");
    var nativeDate = document.getElementById("mayaNativeDate");
    if (dateButton && nativeDate) {
      dateButton.addEventListener("click", function () {
        if (nativeDate.showPicker) nativeDate.showPicker();
        else nativeDate.click();
      });
      nativeDate.addEventListener("change", function () {
        state.gemData.dob = toIndianDate(nativeDate.value);
        input.value = state.gemData.dob;
      });
    }
    var timeButton = document.getElementById("mayaTimeButton");
    var nativeTime = document.getElementById("mayaNativeTime");
    if (timeButton && nativeTime) {
      timeButton.addEventListener("click", function () {
        if (nativeTime.showPicker) nativeTime.showPicker();
        else nativeTime.click();
      });
      nativeTime.addEventListener("change", function () {
        state.gemData.tob = nativeTime.value;
        input.value = state.gemData.tob;
      });
    }
    if (step.key === "birth_city") {
      var gemPlaceSearch = document.getElementById("mayaGemPlaceSearch");
      if (gemPlaceSearch) gemPlaceSearch.addEventListener("click", function () {
        searchGlobalPlaces(input.value, { target: state.gemData, listId: "mayaCityList", statusId: "mayaCityStatus", inputId: "mayaGemInput", tokenKey: "gemPlace" });
      });
      document.addEventListener("click", function closeCityList(event) {
        var list = document.getElementById("mayaCityList");
        if (list && !event.target.closest(".maya-city-wrap")) {
          list.classList.remove("is-open");
        }
      });
    }
    var back = document.getElementById("gemBack");
    if (back) back.addEventListener("click", function () { state.gemStep = Math.max(0, state.gemStep - 1); renderGemstone(); });
    var unknown = document.getElementById("gemUnknown");
    if (unknown) unknown.addEventListener("click", function () { state.gemData.tob = "12:00"; state.gemStep += 1; renderGemstone(); });
    document.getElementById("gemNext").addEventListener("click", function () {
      state.gemData[step.key] = input.value;
      if (step.key !== "tob" && !String(input.value || "").trim()) {
        input.focus();
        return;
      }
      if (step.key === "dob" && !isValidIndianDob(input.value)) {
        var error = document.getElementById("mayaFieldError");
        if (error) {
          error.textContent = "Please enter date of birth in DD/MM/YYYY format, or use the calendar icon.";
          error.classList.add("is-visible");
        }
        input.focus();
        return;
      }
      if (step.key === "birth_city" && (state.gemData.birth_lat === null || state.gemData.birth_lon === null)) {
        var cityError = document.getElementById("mayaFieldError");
        if (cityError) {
          cityError.textContent = "Please select your exact birth place from the list.";
          cityError.classList.add("is-visible");
        }
        input.focus();
        return;
      }
      if (step.key === "tob") {
        var parsedTime = normaliseTime(input.value);
        if (!parsedTime) {
          var timeError = document.getElementById("mayaFieldError");
          if (timeError) {
            timeError.textContent = "Please select time using the clock icon, or type like 14:35 / 2:35 PM.";
            timeError.classList.add("is-visible");
          }
          input.focus();
          return;
        }
        state.gemData.tob = parsedTime;
      }
      if (state.gemStep === gemSteps.length - 1) submitGemstone();
      else {
        state.gemStep += 1;
        renderGemstone();
      }
    });
  }

  async function submitGemstone() {
    state.gemLoading = true;
    renderGemstone();
    try {
      state.gemResult = await postJson(["/api/gemstone/recommend"], {
        session_id: state.sessionId,
        name: state.gemData.name,
        whatsapp: state.gemData.whatsapp,
        dob: dobForApi(state.gemData.dob),
        tob: normaliseTime(state.gemData.tob) || "12:00",
        birth_city: state.gemData.birth_city,
        latitude: state.gemData.birth_lat,
        longitude: state.gemData.birth_lon,
        timezone: state.gemData.birth_tz || null,
        goal: state.gemData.goal || null
      });
    } catch (error) {
      state.gemResult = fallbackGemstoneResult(error.message);
    }
    state.gemLoading = false;
    renderGemstone();
  }

  function renderReport() {
    var body = document.getElementById("mayaBody");
    var result = state.gemResult || {};
    var cards = result.recommendations || [];
    var shareText = encodeURIComponent("Maya Remedy Report for " + state.gemData.name + "\n" + cards.map(function (card, index) { return (index + 1) + ". " + card.name; }).join("\n"));
    var phone = String(state.gemData.whatsapp || "").replace(/\D/g, "");
    body.innerHTML = [
      '<div class="maya-report">',
      '<div><div class="maya-kicker">Maya Remedy Report</div><div class="maya-title">' + escapeHtml(state.gemData.name) + ', your bracelet path is ready.</div><p class="maya-copy">' + escapeHtml(result.message) + '</p></div>',
      cards.slice(0, 3).map(function (card) {
        return '<article class="maya-remedy"><h4>' + escapeHtml(card.name) + '</h4><p>' + escapeHtml(card.why || card.planetary_reason) + '</p><p><strong>Dasha/Gochar:</strong> ' + escapeHtml(card.dasha_gochar_reason) + '</p><p><strong>Best period:</strong> ' + escapeHtml(card.best_period) + '</p><p><strong>Wearing:</strong> ' + escapeHtml(card.wearing_instruction) + '</p><p><strong>' + escapeHtml(card.price) + '</strong></p><a href="' + escapeHtml(card.product_url) + '">Order Now</a></article>';
      }).join(""),
      result.final_remedy ? '<article class="maya-remedy"><h4>One Remedy</h4><p>' + escapeHtml(result.final_remedy) + '</p></article>' : '',
      '<a class="maya-whatsapp" target="_blank" rel="noopener" href="https://wa.me/' + phone + '?text=' + shareText + '">Send result on WhatsApp</a>',
      '<button class="maya-secondary" type="button" id="gemRestart">Start again</button>',
      '<div class="maya-disclaimer">' + escapeHtml(result.disclaimer) + '</div>',
      '</div>'
    ].join("");
    document.getElementById("gemRestart").addEventListener("click", function () {
      state.gemStep = 0;
      state.gemResult = null;
      state.gemData = { name: "", goal: "", dob: "", tob: "", birth_city: "", birth_lat: null, birth_lon: null, birth_tz: "", whatsapp: "" };
      renderGemstone();
    });
  }

  function openGemstone() {
    state.mode = "gemstone";
    state.gemStep = 0;
    state.gemResult = null;
    openPanel();
    renderGemstone();
  }

  function bindEvents() {
    document.querySelector("[data-maya-open]").addEventListener("click", openChoice);
    document.querySelectorAll("[data-maya-close]").forEach(function (button) { button.addEventListener("click", closeAll); });
    document.querySelector('[data-maya-mode="gemstone"]').addEventListener("click", openGemstone);
    document.querySelector('[data-maya-mode="astrologer"]').addEventListener("click", openAstrologer);
    document.getElementById("mayaChatFoot").addEventListener("submit", function (event) {
      event.preventDefault();
      var input = document.getElementById("mayaChatInput");
      var text = input.value.trim();
      if (!text) return;
      input.value = "";
      sendChat(text);
    });
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (target.closest("#mayaCreditsWidget")) return;
      var text = String(target.innerText || target.textContent || "").toLowerCase();
      if (text.includes("talk to maya") || text.includes("talk to maaya") || text.includes("ask ai")) {
        event.preventDefault();
        openChoice();
      }
    });
  }

  function init() {
    createWidget();
    bindEvents();
    closeAll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

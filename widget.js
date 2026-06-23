(function () {
  "use strict";

  var WIDGET_VERSION = "maaya-oracle-2026-06-23-v2";
  if (window.__VESHANN_MAYA_CREDITS_WIDGET__ === WIDGET_VERSION) return;
  if (window.__VESHANN_MAYA_CREDITS_WIDGET__) {
    try {
      var oldRoot = document.getElementById("mayaCreditsWidget");
      if (oldRoot && oldRoot.parentNode) oldRoot.parentNode.removeChild(oldRoot);
      var oldStyle = document.getElementById("maya-credits-widget-style");
      if (oldStyle && oldStyle.parentNode) oldStyle.parentNode.removeChild(oldStyle);
    } catch (e) {}
  }
  window.__VESHANN_MAYA_CREDITS_WIDGET__ = WIDGET_VERSION;

  // Keep API calls pinned to the FastAPI backend. If this widget is copied onto
  // veshannastro.co.in, document.currentScript points at the static website and
  // relative API calls fail. Use the script origin only for Render/local builds.
  var DEFAULT_API_BASE = "https://new-ai-chatbot-bv0n.onrender.com";
  var API_BASE = (function () {
    try {
      if (window.VESHANN_MAYA_API_BASE) return String(window.VESHANN_MAYA_API_BASE).replace(/\/+$/, "");
      var current = document.currentScript && document.currentScript.src;
      var configured = document.currentScript && document.currentScript.getAttribute("data-api-base");
      if (configured) return String(configured).replace(/\/+$/, "");
      if (current) {
        var origin = new URL(current).origin;
        if (/onrender\.com$/i.test(new URL(origin).hostname) || /localhost|127\.0\.0\.1/i.test(origin)) return origin;
      }
    } catch (e) {}
    return DEFAULT_API_BASE;
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
    gemData: { name: "", goal: "", dob: "", tob: "", time_unknown: false, birth_city: "", birth_lat: null, birth_lon: null, birth_tz: "", whatsapp: "" },
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

  var SHOP_URL = "https://veshannastro.co.in/";
  function braceletImageUrl(sku) {
    return "https://veshannastro.co.in/images/bracelets/" + encodeURIComponent(sku) + ".webp";
  }

  function braceletCheckoutUrl(skus, fallbackUrl) {
    if (fallbackUrl) return fallbackUrl;
    var clean = (skus || []).filter(Boolean).join(",");
    return SHOP_URL + "?maya_bundle=" + encodeURIComponent(clean) + "#bracelet-shop";
  }

  function money(value) {
    var amount = Number(value || 0);
    return "Rs. " + amount.toLocaleString("en-IN");
  }

  function braceletImageFallback(img) {
    var base = img.getAttribute("data-img-base");
    var current = Number(img.getAttribute("data-img-ext-index") || "0");
    var exts = ["webp", "jpg", "jpeg", "png"];
    var next = current + 1;
    if (!base || next >= exts.length) {
      img.onerror = null;
      img.style.display = "none";
      var parent = img.parentElement;
      if (parent && !parent.querySelector(".maya-product-fallback")) {
        parent.insertAdjacentHTML("beforeend", '<div class="maya-product-fallback">Veshannastro</div>');
      }
      return;
    }
    img.setAttribute("data-img-ext-index", String(next));
    img.src = base + "." + exts[next];
  }
  window.mayaBraceletImageFallback = braceletImageFallback;

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
    if (!document.getElementById("maya-credits-widget-fonts")) {
      var fontLink = document.createElement("link");
      fontLink.id = "maya-credits-widget-fonts";
      fontLink.rel = "stylesheet";
      fontLink.href = "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=Fraunces:opsz,wght@9..144,400;9..144,500&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap";
      document.head.appendChild(fontLink);
    }
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
      ".maya-product-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.maya-product-card{overflow:hidden;background:#fffdf7;border:1px solid rgba(146,104,43,.25);border-radius:18px;box-shadow:0 16px 34px rgba(70,47,24,.1)}.maya-product-media{position:relative;aspect-ratio:1/1;background:#f4e7d4;display:grid;place-items:center;overflow:hidden}.maya-product-media img{width:100%;height:100%;object-fit:cover;display:block}.maya-product-fallback{width:100%;height:100%;display:grid;place-items:center;color:#8b6224;font:700 16px Georgia,serif;background:radial-gradient(circle at 35% 25%,#fff8dc,#dfc082)}.maya-product-badge{position:absolute;left:10px;top:10px;padding:5px 8px;border-radius:999px;background:#251d16;color:#fff8e9;font-size:11px;font-weight:900}.maya-product-body{padding:13px;display:grid;gap:8px}.maya-product-sku{color:#956b24;font-size:10.5px;font-weight:900;text-transform:uppercase}.maya-product-card h4{margin:0;color:#211a14;font:600 18px/1.15 Georgia,serif}.maya-product-card p{margin:0;color:#5d4935;font-size:12.5px;line-height:1.42}.maya-product-buy{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:2px}.maya-product-buy span{display:grid;gap:1px;color:#211a14}.maya-product-buy small{color:#7a6248;font-size:11px}.maya-product-buy button,.maya-cart-cta button{min-height:38px;padding:0 13px;border:0;border-radius:999px;background:#251d16;color:#fff8e9;font-weight:900;cursor:pointer}.maya-product-buy button:disabled,.maya-cart-cta button:disabled{opacity:.72;cursor:wait}.maya-cart-cta{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;background:#fff3da;border:1px solid rgba(146,104,43,.25);border-radius:16px}.maya-cart-cta div{display:grid;gap:2px;color:#241c15}.maya-cart-cta span{color:#6b5239;font-size:12.5px}.maya-cart-fly{position:fixed;z-index:2147483000;width:36px;height:36px;border-radius:999px;background:radial-gradient(circle at 35% 30%,#fff4b2,#d4a236 70%,#3a2b1d);box-shadow:0 14px 40px rgba(42,31,20,.32);pointer-events:none;transition:transform .68s cubic-bezier(.18,.78,.24,1),opacity .68s ease}",
      ".maya-kundli-card{margin:0 0 14px;padding:14px;background:#fffdf7;border:1px solid rgba(146,104,43,.22);border-radius:18px;box-shadow:0 16px 34px rgba(70,47,24,.1)}.maya-kundli-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}.maya-kundli-top h4{margin:0;color:#241c15;font:600 20px/1.1 Georgia,serif}.maya-kundli-top p{margin:4px 0 0;color:#6b5239;font-size:12.5px;line-height:1.35}.maya-kundli-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.maya-house{min-height:66px;padding:7px;background:#fbf3e7;border:1px solid rgba(146,104,43,.22);border-radius:12px;display:grid;align-content:space-between}.maya-house b{color:#8b6224;font-size:11px}.maya-house span{color:#211a14;font-size:12px;font-weight:800}.maya-house small{color:#6b5239;font-size:11px;line-height:1.25}.maya-chip-row{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}.maya-chip{padding:7px 9px;background:#f7ead6;color:#4f3c2a;border:1px solid rgba(146,104,43,.18);border-radius:999px;font-size:11.5px;font-weight:800}.maya-accordion{display:grid;gap:8px;margin:0 0 14px}.maya-accordion details{background:#fffaf1;border:1px solid rgba(146,104,43,.18);border-radius:12px;padding:10px 12px}.maya-accordion summary{cursor:pointer;color:#3a2b1d;font-weight:900;font-size:13px}.maya-accordion p{margin:8px 0 0;color:#695039;font-size:12.5px;line-height:1.45}.maya-timeline{margin-top:10px;padding:10px;background:#f7ead6;border:1px solid rgba(146,104,43,.16);border-radius:12px}.maya-mini-title{font-size:11px;font-weight:900;text-transform:uppercase;color:#956b24;margin-bottom:7px}.maya-time-row{display:flex;align-items:center;gap:8px;margin-top:5px;color:#3a2b1d;font-size:12px}.maya-time-row span{width:20px;height:20px;display:grid;place-items:center;border-radius:999px;background:#251d16;color:#fff8e9;font-size:10px}.maya-credit-note{max-width:82%;margin:0 0 12px;padding:9px 12px;background:#f7ead6;border:1px solid rgba(146,104,43,.18);border-radius:12px;color:#5b452f;font-size:12.5px;font-weight:800}.maya-typing{display:inline-flex;gap:4px}.maya-typing i{width:6px;height:6px;border-radius:999px;background:#9a722d;animation:mayaBlink 1s infinite ease-in-out}.maya-typing i:nth-child(2){animation-delay:.16s}.maya-typing i:nth-child(3){animation-delay:.32s}@keyframes mayaBlink{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}",
      ".maya-kundli-card--reference{padding:0;background:transparent;border:0;box-shadow:none}.maya-kundli-svg{width:100%;max-width:512px;display:block;margin:0 auto;background:transparent}.maya-kundli-outer{fill:#fffbd4;stroke:#ffad00;stroke-width:8;stroke-linejoin:round}.maya-kundli-inner-border{fill:none;stroke:#ff1b14;stroke-width:3;stroke-linejoin:round}.maya-kundli-line{fill:none;stroke:#ff1b14;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}.maya-kundli-house{font-family:Georgia,'Times New Roman',serif;text-anchor:middle;fill:#c8102e;font-size:20px;font-weight:800}.maya-kundli-sign{font-family:Arial,system-ui,sans-serif;text-anchor:middle;fill:#16120f;font-size:13px;font-weight:800}.maya-kundli-planets{font-family:Arial,system-ui,sans-serif;text-anchor:middle;fill:#241c15;font-size:12px;font-weight:900}",
      "@keyframes mayaStepIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}.maya-step-anim{animation:mayaStepIn .38s cubic-bezier(.22,.61,.36,1)}",
      ".maya-progress span{transition:width .45s cubic-bezier(.22,.61,.36,1)}",
      ".maya-choice-card{transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}.maya-choice-card:hover{transform:translateY(-2px);box-shadow:0 22px 46px rgba(70,47,24,.16)}.maya-choice-card:active{transform:translateY(0)}",
      ".maya-choice-grid--goal{grid-template-columns:1fr}.maya-choice-card--goal{min-height:0;padding:15px 17px;display:flex;align-items:center;gap:14px;position:relative}.maya-choice-card--goal .maya-goal-icon{width:38px;height:38px;flex-shrink:0;border-radius:999px;display:grid;place-items:center;font-size:18px;background:radial-gradient(circle at 35% 30%,#fff2ad,#d9ae3e 68%,#9f7425);color:#241c15}.maya-choice-card--goal .maya-goal-text{display:grid;gap:2px}.maya-choice-card--goal strong{font:600 16px/1.2 Georgia,serif}.maya-choice-card--goal span{font-size:12.5px}.maya-choice-card--goal.is-selected{border-color:#b78325;background:#fff3da;box-shadow:0 0 0 2px rgba(183,131,37,.35),0 18px 38px rgba(70,47,24,.14)}.maya-choice-card--goal.is-selected::after{content:'\\2713';position:absolute;right:14px;top:50%;transform:translateY(-50%);width:24px;height:24px;border-radius:999px;background:#176f46;color:#fffaf0;display:grid;place-items:center;font-size:13px;font-weight:900}",
      ".maya-city-wrap{position:relative}.maya-city-list{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:5;background:#fffaf1;border:1px solid rgba(146,104,43,.3);border-radius:14px;box-shadow:0 22px 50px rgba(70,47,24,.2);max-height:260px;overflow:auto;display:none}.maya-city-list.is-open{display:block}.maya-city-option{display:flex;flex-direction:column;gap:1px;width:100%;text-align:left;padding:11px 14px;border:0;border-bottom:1px solid rgba(146,104,43,.12);background:transparent;cursor:pointer;font-family:inherit}.maya-city-option:last-child{border-bottom:0}.maya-city-option:hover,.maya-city-option.is-active{background:#fff3da}.maya-city-option strong{font-size:14px;color:#241c15;font-weight:700}.maya-city-option small{font-size:12px;color:#7a6248}.maya-city-confirmed{display:flex;align-items:center;gap:8px;margin-top:8px;padding:8px 12px;background:#eaf3de;border:1px solid rgba(39,80,10,.2);border-radius:12px;color:#27500a;font-size:12.5px;font-weight:700}.maya-city-unconfirmed{display:flex;align-items:center;gap:8px;margin-top:8px;padding:8px 12px;background:#fff0e8;border:1px solid rgba(123,45,28,.18);border-radius:12px;color:#7b2d1c;font-size:12.5px;line-height:1.45}",
      "@media(max-width:720px){.maya-choice-grid{grid-template-columns:1fr}.maya-product-grid{grid-template-columns:1fr}.maya-cart-cta{align-items:flex-start;flex-direction:column}.maya-panel{width:100vw;height:100svh;border-radius:0}.maya-box{width:calc(100vw - 20px)}.maya-launcher{right:14px;bottom:14px}.maya-msg{max-width:92%}}",
      `#mayaCreditsWidget{
  --maya-cosmos:#070A13;
  --maya-cosmos-2:#0D1122;
  --maya-cosmos-3:#14182E;
  --maya-bg:#F2E8D2;
  --maya-bg-deep:#E6D4B0;
  --maya-surface:#FAF4E8;
  --maya-surface-2:#FDF9F1;
  --maya-gold:#C9A050;
  --maya-gold-lt:#E8C87A;
  --maya-gold-dim:#8A6830;
  --maya-navy:#1A2438;
  --maya-navy-mid:#2E3F62;
  --maya-gray:#635B4E;
  --maya-gray-soft:#8C8070;
  --maya-line:#B8925A;
  --maya-line-soft:#D4BB8A;
  --maya-line-faint:#E8D9C0;
  --maya-display:'Cinzel',Georgia,serif;
  --maya-body:'Fraunces',Georgia,serif;
  --maya-ui:'IBM Plex Sans',system-ui,sans-serif;
  --maya-mono:'IBM Plex Mono',ui-monospace,monospace;
}
#mayaCreditsWidget *{box-sizing:border-box}
#mayaCreditsWidget .maya-launcher{
  right:22px;bottom:22px;border-radius:4px;padding:13px 20px;
  background:linear-gradient(135deg,#2E2017 0%,#171015 100%);
  color:#FDF9F1;border:1px solid rgba(201,160,80,.48);
  box-shadow:0 0 0 1px rgba(7,10,19,.85),0 22px 58px rgba(0,0,0,.46),0 0 42px rgba(201,160,80,.12);
  font-family:var(--maya-ui);font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
}
#mayaCreditsWidget .maya-overlay{
  background:
    radial-gradient(ellipse 700px 450px at 18% 22%,rgba(55,28,95,.38) 0%,transparent 100%),
    radial-gradient(ellipse 500px 350px at 82% 68%,rgba(28,18,70,.32) 0%,transparent 100%),
    linear-gradient(160deg,#0A0D1C 0%,#070A13 55%,#0D0919 100%);
  backdrop-filter:blur(10px);
}
#mayaCreditsWidget .maya-overlay::before{
  content:"";position:absolute;inset:0;pointer-events:none;opacity:.82;
  background-image:
    radial-gradient(circle at 8% 18%,rgba(255,249,230,.85) 0 1px,transparent 1px),
    radial-gradient(circle at 17% 72%,rgba(255,249,230,.48) 0 1px,transparent 1px),
    radial-gradient(circle at 34% 9%,rgba(255,249,230,.78) 0 1px,transparent 1px),
    radial-gradient(circle at 55% 66%,rgba(255,249,230,.42) 0 1px,transparent 1px),
    radial-gradient(circle at 74% 21%,rgba(255,249,230,.7) 0 1px,transparent 1px),
    radial-gradient(circle at 91% 48%,rgba(255,249,230,.52) 0 1px,transparent 1px);
  background-size:260px 210px,310px 240px,390px 280px,330px 230px,420px 300px,360px 250px;
}
#mayaCreditsWidget .maya-box,
#mayaCreditsWidget .maya-panel{
  width:min(430px,calc(100vw - 28px));
  background:var(--maya-bg);
  color:var(--maya-navy);
  border:1px solid var(--maya-gold-dim);
  border-radius:6px;
  padding:6px;
  box-shadow:
    0 0 0 5px var(--maya-cosmos-2),
    0 0 0 6px var(--maya-gold-dim),
    0 50px 130px rgba(0,0,0,.68),
    0 0 100px rgba(201,160,80,.08);
  font-family:var(--maya-ui);
}
#mayaCreditsWidget .maya-panel{
  height:min(760px,calc(100svh - 26px));
  grid-template-rows:auto auto minmax(0,1fr) auto;
  overflow:hidden;
  box-shadow:
    0 0 0 100vmax rgba(7,10,19,.78),
    0 0 0 5px var(--maya-cosmos-2),
    0 0 0 6px var(--maya-gold-dim),
    0 50px 130px rgba(0,0,0,.72),
    0 0 100px rgba(201,160,80,.08);
}
#mayaCreditsWidget .maya-box{max-height:calc(100svh - 28px);overflow:auto}
#mayaCreditsWidget .maya-box::after,
#mayaCreditsWidget .maya-panel::after{
  content:"";position:absolute;inset:0;pointer-events:none;opacity:.028;z-index:4;border-radius:inherit;
  background-image:linear-gradient(45deg,rgba(26,36,56,.5) 25%,transparent 25%),linear-gradient(-45deg,rgba(26,36,56,.5) 25%,transparent 25%);
  background-size:4px 4px;
}
#mayaCreditsWidget .maya-box,
#mayaCreditsWidget .maya-panel{position:fixed}
#mayaCreditsWidget .maya-box{position:relative;z-index:1}
#mayaCreditsWidget .maya-head,
#mayaCreditsWidget .maya-content,
#mayaCreditsWidget .maya-body,
#mayaCreditsWidget .maya-foot{
  position:relative;z-index:2;border-left:1px solid var(--maya-line-soft);border-right:1px solid var(--maya-line-soft);
}
#mayaCreditsWidget .maya-head{
  min-height:64px;padding:15px 14px 13px;align-items:center;
  background:linear-gradient(180deg,var(--maya-bg) 0%,#F7EDDA 100%);
  border-top:1px solid var(--maya-line-soft);border-bottom:1px solid var(--maya-line-soft);
}
#mayaCreditsWidget .maya-brand{gap:10px}
#mayaCreditsWidget .maya-orb{
  width:28px;height:28px;position:relative;flex-shrink:0;border-radius:50%;
  background:transparent;border:1.5px solid var(--maya-navy);box-shadow:none;color:var(--maya-navy);
}
#mayaCreditsWidget .maya-orb::before{
  content:"";position:absolute;left:50%;top:50%;width:4px;height:4px;border-radius:50%;
  background:currentColor;transform:translate(-50%,-50%);
}
#mayaCreditsWidget .maya-orb::after{
  content:"";position:absolute;inset:5px;border-radius:50%;border:1px solid rgba(26,36,56,.4);
}
#mayaCreditsWidget .maya-brand h3{
  color:var(--maya-gold);font-family:var(--maya-display);font-weight:600;font-size:16px;letter-spacing:3px;
  background:linear-gradient(125deg,#E8C87A 0%,#C9A050 45%,#E8D090 70%,#C9A050 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
#mayaCreditsWidget .maya-brand p{
  margin-top:2px;color:var(--maya-gray-soft);font-family:var(--maya-ui);font-size:9.5px;letter-spacing:1.6px;text-transform:uppercase;
}
#mayaCreditsWidget .maya-close{
  width:32px;height:32px;border-radius:4px;border:1px solid rgba(184,146,90,.45);
  background:var(--maya-surface-2);color:var(--maya-navy);font-size:22px;line-height:1;box-shadow:0 4px 12px rgba(26,36,56,.08);
}
#mayaCreditsWidget .maya-astro-art{
  position:relative;z-index:2;height:104px;overflow:hidden;
  border-left:1px solid var(--maya-line-soft);border-right:1px solid var(--maya-line-soft);
  border-bottom:1px solid var(--maya-line-faint);
  background:
    radial-gradient(ellipse at 54% 34%,rgba(78,56,145,.48) 0%,transparent 54%),
    linear-gradient(180deg,#1A1028 0%,#0E0D1E 52%,#1A1028 100%);
}
#mayaCreditsWidget .maya-astro-art::before{
  content:"";position:absolute;left:-8%;right:-8%;bottom:12px;height:78px;border-top:1px dashed rgba(201,160,80,.42);
  border-radius:50% 50% 0 0;transform:rotate(-2deg);
}
#mayaCreditsWidget .maya-astro-art::after{
  content:"";position:absolute;inset:0;opacity:.92;
  background-image:
    radial-gradient(circle at 13% 60%,#E8C87A 0 1.5px,transparent 2px),
    radial-gradient(circle at 25% 42%,#E8D090 0 2px,transparent 2.5px),
    radial-gradient(circle at 42% 28%,#E8C87A 0 1.5px,transparent 2px),
    radial-gradient(circle at 55% 36%,#E8D090 0 2.5px,transparent 3px),
    radial-gradient(circle at 72% 42%,#E8D090 0 2px,transparent 2.5px),
    radial-gradient(circle at 88% 58%,#E8C87A 0 1.8px,transparent 2.4px);
}
#mayaCreditsWidget .maya-astro-core{
  position:absolute;left:50%;top:31px;z-index:2;width:42px;height:42px;border-radius:50%;
  transform:translateX(-50%);border:1px solid rgba(201,160,80,.72);
  box-shadow:0 0 32px rgba(201,160,80,.18),inset 0 0 18px rgba(201,160,80,.08);
}
#mayaCreditsWidget .maya-astro-core::before,
#mayaCreditsWidget .maya-astro-core::after{
  content:"";position:absolute;left:50%;top:50%;width:62px;height:12px;border:1px solid rgba(201,160,80,.55);
  border-radius:50%;transform:translate(-50%,-50%) rotate(-12deg);
}
#mayaCreditsWidget .maya-astro-core::after{width:78px;height:1px;border:0;background:rgba(201,160,80,.45)}
#mayaCreditsWidget .maya-content{
  padding:20px 18px 18px;background:linear-gradient(180deg,var(--maya-bg) 0%,#F7EDDA 100%);
  border-bottom:1px solid var(--maya-line-soft);
}
#mayaCreditsWidget .maya-kicker{
  color:var(--maya-gold-dim);font-family:var(--maya-mono);font-size:9px;font-weight:500;letter-spacing:1.2px;text-transform:uppercase;
}
#mayaCreditsWidget .maya-title{
  margin:7px 0 10px;color:var(--maya-navy);font-family:var(--maya-display);font-weight:600;
  font-size:clamp(21px,5vw,28px);line-height:1.12;letter-spacing:.04em;
}
#mayaCreditsWidget .maya-copy{color:var(--maya-gray);font-family:var(--maya-body);font-size:14px;line-height:1.62}
#mayaCreditsWidget .maya-choice-grid{grid-template-columns:1fr;gap:10px}
#mayaCreditsWidget .maya-choice-card{
  min-height:0;padding:14px 15px;border-radius:0 10px 10px 0;border:1px solid var(--maya-line-soft);border-left:3px solid var(--maya-gold);
  background:linear-gradient(135deg,var(--maya-surface-2) 0%,var(--maya-surface) 100%);
  box-shadow:4px 4px 20px rgba(201,160,80,.1),0 1px 8px rgba(26,36,56,.06);
}
#mayaCreditsWidget .maya-choice-card strong{font-family:var(--maya-display);font-size:16px;letter-spacing:.04em;color:var(--maya-navy)}
#mayaCreditsWidget .maya-choice-card span{font-family:var(--maya-ui);font-size:12.5px;color:var(--maya-gray);line-height:1.45}
#mayaCreditsWidget .maya-choice-card:hover{transform:translateY(-1px);box-shadow:4px 8px 26px rgba(201,160,80,.16)}
#mayaCreditsWidget .maya-body{
  padding:16px 18px 8px;overflow-y:auto;background:linear-gradient(180deg,var(--maya-bg) 0%,#F5EAD8 100%);
  scrollbar-width:thin;scrollbar-color:var(--maya-line-soft) transparent;
}
#mayaCreditsWidget .maya-body::before{
  content:"";position:absolute;right:-16px;top:44%;width:145px;height:145px;border:1px solid rgba(201,160,80,.07);
  border-radius:50%;pointer-events:none;
}
#mayaCreditsWidget .maya-msg{
  position:relative;z-index:1;margin-bottom:18px;max-width:100%;border-radius:0;padding:0;font-family:var(--maya-body);font-size:14.5px;line-height:1.68;
}
#mayaCreditsWidget .maya-bot{
  padding:12px 14px;border:1px solid var(--maya-line-soft);border-left:3px solid var(--maya-gold);border-radius:0 12px 12px 0;
  color:var(--maya-navy);background:linear-gradient(135deg,var(--maya-surface-2) 0%,var(--maya-surface) 100%);
  box-shadow:4px 4px 20px rgba(201,160,80,.1),0 1px 8px rgba(26,36,56,.06);
}
#mayaCreditsWidget .maya-bot strong{color:var(--maya-navy)}
#mayaCreditsWidget .maya-bot p{margin:0 0 8px}
#mayaCreditsWidget .maya-bot p:last-child{margin-bottom:0}
#mayaCreditsWidget .maya-user{
  width:max-content;max-width:78%;margin-left:auto;padding:9px 14px;border-radius:14px 14px 4px 14px;
  background:var(--maya-navy);color:var(--maya-bg);font-family:var(--maya-body);font-style:italic;box-shadow:0 4px 18px rgba(26,36,56,.22);
}
#mayaCreditsWidget .maya-credit-bar{
  padding:10px 0;margin:0 0 14px;border:0;border-top:1px solid var(--maya-line-faint);border-bottom:1px solid var(--maya-line-faint);
  border-radius:0;background:transparent;color:var(--maya-gray);font-family:var(--maya-ui);font-size:10px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;
}
#mayaCreditsWidget .maya-credit-bar span{color:var(--maya-navy-mid);font-family:var(--maya-mono);font-size:11px;font-weight:500}
#mayaCreditsWidget .maya-foot{
  gap:12px;padding:12px 18px 16px;background:linear-gradient(180deg,#F5EAD8 0%,var(--maya-bg) 100%);
  border-top:1px solid var(--maya-line-soft);border-bottom:1px solid var(--maya-line-soft);align-items:center;
}
#mayaCreditsWidget .maya-input{
  min-height:38px;padding:7px 2px;border:0;border-bottom:1px solid var(--maya-line);border-radius:0;background:transparent;
  color:var(--maya-navy);font-family:var(--maya-body);font-size:14px;outline:none;
}
#mayaCreditsWidget .maya-input:focus{border-color:var(--maya-gold)}
#mayaCreditsWidget .maya-input::placeholder{color:var(--maya-gray-soft);font-style:italic}
#mayaCreditsWidget .maya-send{
  position:relative;width:38px;height:38px;min-height:38px;flex:0 0 38px;padding:0;border:0;border-radius:50%;
  background:transparent;color:var(--maya-gold);font-size:0;box-shadow:none;
}
#mayaCreditsWidget .maya-send::before{
  content:"";position:absolute;inset:0;border-radius:50%;border:1.5px solid currentColor;
}
#mayaCreditsWidget .maya-send::after{
  content:">";position:absolute;inset:0;display:grid;place-items:center;color:var(--maya-gold);
  font:700 15px/1 var(--maya-ui);transform:translateX(1px);
}
#mayaCreditsWidget .maya-send:hover{transform:scale(1.06)}
#mayaCreditsWidget .maya-primary,
#mayaCreditsWidget .maya-secondary,
#mayaCreditsWidget .maya-pay,
#mayaCreditsWidget .maya-whatsapp,
#mayaCreditsWidget .maya-remedy a,
#mayaCreditsWidget .maya-product-buy button,
#mayaCreditsWidget .maya-cart-cta button{
  border-radius:4px;font-family:var(--maya-ui);font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;
}
#mayaCreditsWidget .maya-primary,
#mayaCreditsWidget .maya-product-buy button,
#mayaCreditsWidget .maya-cart-cta button,
#mayaCreditsWidget .maya-whatsapp,
#mayaCreditsWidget .maya-pay{
  background:var(--maya-navy);color:var(--maya-bg);
}
#mayaCreditsWidget .maya-secondary{
  background:linear-gradient(135deg,var(--maya-surface-2),var(--maya-bg));
  color:var(--maya-navy-mid);border:1px solid var(--maya-line-soft);
}
#mayaCreditsWidget .maya-progress{height:4px;margin:12px 0 18px;background:var(--maya-line-faint);border-radius:2px}
#mayaCreditsWidget .maya-progress span{
  background:linear-gradient(90deg,var(--maya-navy-mid) 0%,var(--maya-gold) 50%,var(--maya-navy-mid) 100%);
  background-size:260% 100%;
}
#mayaCreditsWidget .maya-field{gap:8px}
#mayaCreditsWidget .maya-field label{
  color:var(--maya-gold-dim);font-family:var(--maya-mono);font-size:9px;font-weight:500;letter-spacing:1.2px;text-transform:uppercase;
}
#mayaCreditsWidget .maya-field input{
  min-height:46px;border-radius:4px;background:var(--maya-surface-2);border:1px solid var(--maya-line-soft);
  color:var(--maya-navy);font-family:var(--maya-ui);font-size:14px;
}
#mayaCreditsWidget .maya-icon-button{
  width:34px;height:34px;border-radius:4px;background:var(--maya-bg);border:1px solid var(--maya-line-soft);
  color:var(--maya-navy);font-size:15px;
}
#mayaCreditsWidget .maya-field-hint{color:var(--maya-gray-soft);font-family:var(--maya-ui);font-size:11px}
#mayaCreditsWidget .maya-city-list{border-radius:4px;background:var(--maya-surface-2);border-color:var(--maya-line-soft)}
#mayaCreditsWidget .maya-city-option strong{font-family:var(--maya-ui);color:var(--maya-navy)}
#mayaCreditsWidget .maya-city-option small{font-family:var(--maya-ui);color:var(--maya-gray)}
#mayaCreditsWidget .maya-report{gap:12px}
#mayaCreditsWidget .maya-product-grid{grid-template-columns:1fr;gap:12px}
#mayaCreditsWidget .maya-product-card,
#mayaCreditsWidget .maya-remedy,
#mayaCreditsWidget .maya-upgrade,
#mayaCreditsWidget .maya-kundli-card,
#mayaCreditsWidget .maya-accordion details,
#mayaCreditsWidget .maya-cart-cta{
  border-radius:0 10px 10px 0;border:1px solid var(--maya-line-soft);border-left:3px solid var(--maya-gold);
  background:linear-gradient(135deg,var(--maya-surface-2) 0%,var(--maya-surface) 100%);
  box-shadow:4px 4px 20px rgba(201,160,80,.1),0 1px 8px rgba(26,36,56,.06);
}
#mayaCreditsWidget .maya-product-card{overflow:hidden}
#mayaCreditsWidget .maya-product-media{background:linear-gradient(135deg,#1A1028 0%,#0E0D1E 100%)}
#mayaCreditsWidget .maya-product-badge{border-radius:4px;background:var(--maya-navy);font-family:var(--maya-mono);font-size:9px;font-weight:500}
#mayaCreditsWidget .maya-product-body{font-family:var(--maya-ui)}
#mayaCreditsWidget .maya-product-card h4,
#mayaCreditsWidget .maya-remedy h4,
#mayaCreditsWidget .maya-kundli-top h4{
  color:var(--maya-navy);font-family:var(--maya-display);font-size:16px;letter-spacing:.04em;
}
#mayaCreditsWidget .maya-product-card p,
#mayaCreditsWidget .maya-remedy p,
#mayaCreditsWidget .maya-upgrade p,
#mayaCreditsWidget .maya-accordion p,
#mayaCreditsWidget .maya-disclaimer{
  color:var(--maya-gray);font-family:var(--maya-ui);font-size:12.5px;line-height:1.52;
}
#mayaCreditsWidget .maya-kundli-card--reference{border:0;border-radius:0;background:transparent;box-shadow:none;padding:0;margin-bottom:16px}
#mayaCreditsWidget .maya-kundli-svg{max-width:100%;filter:drop-shadow(0 12px 18px rgba(26,36,56,.08))}
#mayaCreditsWidget .maya-accordion summary{font-family:var(--maya-ui);color:var(--maya-navy);font-size:12px;letter-spacing:.04em;text-transform:uppercase}
#mayaCreditsWidget .maya-typing i{background:var(--maya-gold)}
@media(max-width:480px){
  #mayaCreditsWidget .maya-panel{width:100vw;height:100svh;border-radius:0;box-shadow:none}
  #mayaCreditsWidget .maya-box{width:100%;max-height:100svh;border-radius:0;box-shadow:none}
  #mayaCreditsWidget .maya-launcher{right:14px;bottom:14px}
  #mayaCreditsWidget .maya-body{padding-left:16px;padding-right:16px}
  #mayaCreditsWidget .maya-msg{font-size:14px}
  #mayaCreditsWidget .maya-user{max-width:86%}
}`
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
      '<div class="maya-head"><div class="maya-brand"><div class="maya-orb"></div><div><h3>MAAYA</h3><p>Ask the Oracle</p></div></div><button class="maya-close" type="button" data-maya-close>&times;</button></div>',
      '<div class="maya-astro-art" aria-hidden="true"><span class="maya-astro-core"></span></div>',
      '<div class="maya-content"><div class="maya-kicker">Choose your path</div><div class="maya-title">What should Maaya prepare?</div><p class="maya-copy">Pick the reading you want now. Maaya will keep the chart reading and bracelet remedy flow separate.</p>',
      '<div class="maya-choice-grid"><button class="maya-choice-card" type="button" data-maya-mode="gemstone"><strong>Gemstone Bracelet Recommendation</strong><span>Free remedy-style bracelet suggestions using your birth details.</span></button><button class="maya-choice-card" type="button" data-maya-mode="astrologer"><strong>Practical AI Astrologer</strong><span>Share what you want to understand about yourself and let Maya read deeper.</span></button></div>',
      '</div></div></div>',
      '<section class="maya-panel" id="mayaPanel"><div class="maya-head"><div class="maya-brand"><div class="maya-orb"></div><div><h3>MAAYA</h3><p>Ask the Oracle</p></div></div><button class="maya-close" type="button" data-maya-close>&times;</button></div><div class="maya-astro-art" aria-hidden="true"><span class="maya-astro-core"></span></div><div class="maya-body" id="mayaBody"></div><form class="maya-foot" id="mayaChatFoot"><input class="maya-input" id="mayaChatInput" placeholder="Ask Maaya about your chart..." autocomplete="off"><button class="maya-send" type="submit">Send</button></form></section>'
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
        '</div><div class="maya-field-hint">Exact birth time is required for real Kundli, Dasha and Lagna calculation.</div></div>'
      ].join("");
    } else {
      fieldHtml = '<div class="maya-field"><label>' + escapeHtml(step.label) + '</label><input id="mayaAstroInput" type="' + step.type + '" value="' + escapeHtml(fieldValue) + '" placeholder="' + escapeHtml(step.placeholder) + '"></div>';
    }

    body.innerHTML = [
      '<div class="maya-step-anim">',
      '<div class="maya-kicker">Step ' + (state.astroStep + 1) + ' of ' + astroSteps.length + '</div>',
      '<div class="maya-title">' + escapeHtml(step.title) + '</div>',
      '<p class="maya-copy">' + (step.key === "tob" ? "Kundli bina exact birth time ke calculate nahi hogi. Time unknown ho toh Gemstone Bracelet tool numerology fallback use karega." : "Maya needs this to calculate your real Vedic chart -- dasha, transits, and house placements.") + '</p>',
      '<div class="maya-progress"><span style="width:' + percent + '%"></span></div>',
      fieldHtml,
      '<div class="maya-field-error" id="mayaAstroFieldError"></div>',
      '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px">',
      state.astroStep ? '<button class="maya-secondary" type="button" id="astroBack">Back</button>' : "",
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
        tob: normaliseTime(state.astroData.tob),
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

  function renderGemstoneError(message) {
    var body = document.getElementById("mayaBody");
    var safeMessage = message || "Backend connection failed.";
    body.innerHTML = [
      '<div class="maya-step-anim">',
      '<div class="maya-kicker">Connection issue</div>',
      '<div class="maya-title">Bracelet report calculate nahi ho paaya.</div>',
      '<p class="maya-copy">Timed bracelet recommendation backend Kundli engine se hi banegi. Is baar API response nahi mila, isliye Maaya fake Dasha/Gochar report nahi dikhayegi.</p>',
      '<div class="maya-field-error is-visible">' + escapeHtml(safeMessage) + '</div>',
      '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px">',
      '<button class="maya-primary" type="button" id="gemRetry">Try again</button>',
      '<button class="maya-secondary" type="button" id="gemEditDetails">Check details</button>',
      '</div>',
      '</div>'
    ].join("");
    var retry = document.getElementById("gemRetry");
    if (retry) retry.addEventListener("click", submitGemstone);
    var edit = document.getElementById("gemEditDetails");
    if (edit) edit.addEventListener("click", function () {
      state.gemResult = null;
      state.gemLoading = false;
      state.gemStep = state.gemData.time_unknown ? 2 : 3;
      renderGemstone();
    });
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
    if (state.gemData.time_unknown && step && step.key === "birth_city") {
      state.gemStep = Math.min(gemSteps.length - 1, state.gemStep + 1);
      renderGemstone();
      return;
    }
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
        '</div><div class="maya-field-hint">If unknown, Maya will not calculate Kundli. Bracelet report will use DOB + name numerology fallback.</div></div>'
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
      '<p class="maya-copy">' + (step.key === "tob" ? "Exact time gives Dasha-based bracelet logic. Unknown time gives numerology bracelet logic from name and DOB." : "This helps Maya prepare a more personal bracelet recommendation.") + '</p>',
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
    if (back) back.addEventListener("click", function () {
      if (state.gemData.time_unknown && state.gemStep === gemSteps.length - 1) state.gemStep = 3;
      else state.gemStep = Math.max(0, state.gemStep - 1);
      renderGemstone();
    });
    var unknown = document.getElementById("gemUnknown");
    if (unknown) unknown.addEventListener("click", function () {
      state.gemData.tob = "";
      state.gemData.time_unknown = true;
      state.gemData.birth_city = "";
      state.gemData.birth_lat = null;
      state.gemData.birth_lon = null;
      state.gemData.birth_tz = "";
      state.gemStep = gemSteps.length - 1;
      renderGemstone();
    });
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
      if (step.key === "birth_city" && !state.gemData.time_unknown && (state.gemData.birth_lat === null || state.gemData.birth_lon === null)) {
        var cityError = document.getElementById("mayaFieldError");
        if (cityError) {
          cityError.textContent = "Please select your exact birth place from the list.";
          cityError.classList.add("is-visible");
        }
        input.focus();
        return;
      }
      if (step.key === "tob") {
        if (!String(input.value || "").trim()) {
          state.gemData.tob = "";
          state.gemData.time_unknown = true;
          state.gemData.birth_city = "";
          state.gemData.birth_lat = null;
          state.gemData.birth_lon = null;
          state.gemData.birth_tz = "";
          state.gemStep = gemSteps.length - 1;
          renderGemstone();
          return;
        }
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
        state.gemData.time_unknown = false;
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
        tob: state.gemData.time_unknown ? "" : (normaliseTime(state.gemData.tob) || ""),
        birth_city: state.gemData.time_unknown ? "" : state.gemData.birth_city,
        latitude: state.gemData.time_unknown ? null : state.gemData.birth_lat,
        longitude: state.gemData.time_unknown ? null : state.gemData.birth_lon,
        timezone: state.gemData.time_unknown ? null : (state.gemData.birth_tz || null),
        goal: state.gemData.goal || null
      });
      state.gemLoading = false;
      renderGemstone();
    } catch (error) {
      state.gemLoading = false;
      renderGemstoneError(error && error.message ? error.message : "Request failed");
    }
  }

  function startMayaCartHandoff(button, skus, url) {
    if (!skus || !skus.length) return;
    var card = button.closest(".maya-product-card") || document.getElementById("mayaBundleCheckout");
    var source = card && card.getBoundingClientRect ? card.getBoundingClientRect() : button.getBoundingClientRect();
    var dot = document.createElement("div");
    dot.className = "maya-cart-fly";
    dot.style.left = Math.max(12, source.left + source.width / 2 - 18) + "px";
    dot.style.top = Math.max(12, source.top + source.height / 2 - 18) + "px";
    document.body.appendChild(dot);
    requestAnimationFrame(function () {
      dot.style.transform = "translate(calc(100vw - " + Math.round(source.left + source.width / 2 + 88) + "px), calc(100vh - " + Math.round(source.top + source.height / 2 + 92) + "px)) scale(.36)";
      dot.style.opacity = "0";
    });
    button.disabled = true;
    button.textContent = "Adding...";
    setTimeout(function () {
      window.location.href = url || braceletCheckoutUrl(skus);
    }, 720);
  }

  function renderReport() {
    var body = document.getElementById("mayaBody");
    var result = state.gemResult || {};
    var cards = result.recommendations || [];
    var skus = result.recommended_skus || cards.map(function (card) { return card.sku || card.product_id; }).filter(Boolean);
    var checkoutUrl = braceletCheckoutUrl(skus, result.checkout_url);
    var shareText = encodeURIComponent("Maya Remedy Report for " + state.gemData.name + "\n" + cards.map(function (card, index) { return (index + 1) + ". " + card.name; }).join("\n"));
    var phone = String(state.gemData.whatsapp || "").replace(/\D/g, "");
    body.innerHTML = [
      '<div class="maya-report">',
      '<div><div class="maya-kicker">Maya Remedy Report</div><div class="maya-title">' + escapeHtml(state.gemData.name) + ', your bracelet path is ready.</div><p class="maya-copy">' + escapeHtml(result.message) + '</p></div>',
      '<div class="maya-product-grid">' + cards.slice(0, 3).map(function (card) {
        var sku = card.sku || card.product_id || "";
        var img = card.image_url || braceletImageUrl(sku);
        var imgBase = img.replace(/\.(webp|jpg|jpeg|png)(\?.*)?$/i, "");
        return [
          '<article class="maya-product-card" data-card-sku="' + escapeHtml(sku) + '">',
          '  <div class="maya-product-media">',
          '    <img src="' + escapeHtml(img) + '" data-img-base="' + escapeHtml(imgBase) + '" data-img-ext-index="0" alt="' + escapeHtml(card.name) + '" loading="lazy" decoding="async" onerror="window.mayaBraceletImageFallback(this);">',
          '    <span class="maya-product-badge">' + escapeHtml(String(card.discount || "")) + '% OFF</span>',
          '  </div>',
          '  <div class="maya-product-body">',
          '    <div class="maya-product-sku">' + escapeHtml(sku) + ' - Free size</div>',
          '    <h4>' + escapeHtml(card.name) + '</h4>',
          '    <p>' + escapeHtml(card.why || card.planetary_reason) + '</p>',
          card.gemstones ? '<p><strong>Gemstones:</strong> ' + escapeHtml(card.gemstones) + '</p>' : '',
          card.benefits ? '<p><strong>Purpose:</strong> ' + escapeHtml(card.benefits) + '</p>' : '',
          '    <p><strong>Dasha/Gochar:</strong> ' + escapeHtml(card.dasha_gochar_reason) + '</p>',
          '    <p><strong>Best period:</strong> ' + escapeHtml(card.best_period) + '</p>',
          '    <div class="maya-product-buy"><span><strong>' + escapeHtml(card.price || money(card.price_value)) + '</strong>' + (card.mrp ? '<small><s>' + money(card.mrp) + '</s></small>' : '') + '</span><button type="button" data-maya-checkout="' + escapeHtml(sku) + '">Add</button></div>',
          '  </div>',
          '</article>'
        ].join("");
      }).join("") + '</div>',
      '<div class="maya-cart-cta"><div><strong>Recommended set</strong><span>15% AI discount cart mein automatically apply hoga.</span></div><button type="button" id="mayaBundleCheckout" data-maya-checkout="' + escapeHtml(skus.join(",")) + '">Add set to cart</button></div>',
      result.final_prediction ? '<article class="maya-remedy"><h4>Final Conclusion</h4><p>' + escapeHtml(result.final_prediction) + '</p></article>' : '',
      result.final_remedy ? '<article class="maya-remedy"><h4>One Remedy</h4><p>' + escapeHtml(result.final_remedy) + '</p></article>' : '',
      '<a class="maya-whatsapp" target="_blank" rel="noopener" href="https://wa.me/' + phone + '?text=' + shareText + '">Send result on WhatsApp</a>',
      '<button class="maya-secondary" type="button" id="gemRestart">Start again</button>',
      '<div class="maya-disclaimer">' + escapeHtml(result.disclaimer) + '</div>',
      '</div>'
    ].join("");
    body.querySelectorAll("[data-maya-checkout]").forEach(function (button) {
      button.addEventListener("click", function (event) {
        var raw = event.currentTarget.getAttribute("data-maya-checkout") || "";
        var chosenSkus = raw.split(",").map(function (item) { return item.trim(); }).filter(Boolean);
        var url = raw.indexOf(",") > -1 ? checkoutUrl : braceletCheckoutUrl(chosenSkus);
        startMayaCartHandoff(event.currentTarget, chosenSkus, url);
      });
    });
    document.getElementById("gemRestart").addEventListener("click", function () {
      state.gemStep = 0;
      state.gemResult = null;
      state.gemData = { name: "", goal: "", dob: "", tob: "", time_unknown: false, birth_city: "", birth_lat: null, birth_lon: null, birth_tz: "", whatsapp: "" };
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

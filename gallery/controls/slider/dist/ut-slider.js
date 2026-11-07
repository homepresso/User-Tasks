/*! ut-slider 1.2.0 | UserTasks gallery form control | Apache-2.0 | bundles @lit/reactive-element 2.1.2 (BSD-3-Clause), lit 3.3.3 (BSD-3-Clause), lit-element 4.2.2 (BSD-3-Clause), lit-html 3.3.3 (BSD-3-Clause) */
var H=globalThis,I=H.ShadowRoot&&(H.ShadyCSS===void 0||H.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,z=Symbol(),st=new WeakMap,w=class{constructor(t,e,r){if(this._$cssResult$=!0,r!==z)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=e}get styleSheet(){let t=this.o,e=this.t;if(I&&t===void 0){let r=e!==void 0&&e.length===1;r&&(t=st.get(e)),t===void 0&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),r&&st.set(e,t))}return t}toString(){return this.cssText}},it=s=>new w(typeof s=="string"?s:s+"",void 0,z),k=(s,...t)=>{let e=s.length===1?s[0]:t.reduce((r,n,i)=>r+(o=>{if(o._$cssResult$===!0)return o.cssText;if(typeof o=="number")return o;throw Error("Value passed to 'css' function must be a 'css' function result: "+o+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(n)+s[i+1],s[0]);return new w(e,s,z)},ot=(s,t)=>{if(I)s.adoptedStyleSheets=t.map(e=>e instanceof CSSStyleSheet?e:e.styleSheet);else for(let e of t){let r=document.createElement("style"),n=H.litNonce;n!==void 0&&r.setAttribute("nonce",n),r.textContent=e.cssText,s.appendChild(r)}},B=I?s=>s:s=>s instanceof CSSStyleSheet?(t=>{let e="";for(let r of t.cssRules)e+=r.cssText;return it(e)})(s):s;var{is:Lt,defineProperty:Mt,getOwnPropertyDescriptor:Ut,getOwnPropertyNames:Ht,getOwnPropertySymbols:It,getPrototypeOf:qt}=Object,q=globalThis,at=q.trustedTypes,Dt=at?at.emptyScript:"",zt=q.reactiveElementPolyfillSupport,R=(s,t)=>s,V={toAttribute(s,t){switch(t){case Boolean:s=s?Dt:null;break;case Object:case Array:s=s==null?s:JSON.stringify(s)}return s},fromAttribute(s,t){let e=s;switch(t){case Boolean:e=s!==null;break;case Number:e=s===null?null:Number(s);break;case Object:case Array:try{e=JSON.parse(s)}catch{e=null}}return e}},ut=(s,t)=>!Lt(s,t),lt={attribute:!0,type:String,converter:V,reflect:!1,useDefault:!1,hasChanged:ut};Symbol.metadata??=Symbol("metadata"),q.litPropertyMetadata??=new WeakMap;var b=class extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??=[]).push(t)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,e=lt){if(e.state&&(e.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(t)&&((e=Object.create(e)).wrapped=!0),this.elementProperties.set(t,e),!e.noAccessor){let r=Symbol(),n=this.getPropertyDescriptor(t,r,e);n!==void 0&&Mt(this.prototype,t,n)}}static getPropertyDescriptor(t,e,r){let{get:n,set:i}=Ut(this.prototype,t)??{get(){return this[e]},set(o){this[e]=o}};return{get:n,set(o){let u=n?.call(this);i?.call(this,o),this.requestUpdate(t,u,r)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)??lt}static _$Ei(){if(this.hasOwnProperty(R("elementProperties")))return;let t=qt(this);t.finalize(),t.l!==void 0&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties)}static finalize(){if(this.hasOwnProperty(R("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(R("properties"))){let e=this.properties,r=[...Ht(e),...It(e)];for(let n of r)this.createProperty(n,e[n])}let t=this[Symbol.metadata];if(t!==null){let e=litPropertyMetadata.get(t);if(e!==void 0)for(let[r,n]of e)this.elementProperties.set(r,n)}this._$Eh=new Map;for(let[e,r]of this.elementProperties){let n=this._$Eu(e,r);n!==void 0&&this._$Eh.set(n,e)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(t){let e=[];if(Array.isArray(t)){let r=new Set(t.flat(1/0).reverse());for(let n of r)e.unshift(B(n))}else t!==void 0&&e.push(B(t));return e}static _$Eu(t,e){let r=e.attribute;return r===!1?void 0:typeof r=="string"?r:typeof t=="string"?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(t=>t(this))}addController(t){(this._$EO??=new Set).add(t),this.renderRoot!==void 0&&this.isConnected&&t.hostConnected?.()}removeController(t){this._$EO?.delete(t)}_$E_(){let t=new Map,e=this.constructor.elementProperties;for(let r of e.keys())this.hasOwnProperty(r)&&(t.set(r,this[r]),delete this[r]);t.size>0&&(this._$Ep=t)}createRenderRoot(){let t=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return ot(t,this.constructor.elementStyles),t}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(t=>t.hostConnected?.())}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach(t=>t.hostDisconnected?.())}attributeChangedCallback(t,e,r){this._$AK(t,r)}_$ET(t,e){let r=this.constructor.elementProperties.get(t),n=this.constructor._$Eu(t,r);if(n!==void 0&&r.reflect===!0){let i=(r.converter?.toAttribute!==void 0?r.converter:V).toAttribute(e,r.type);this._$Em=t,i==null?this.removeAttribute(n):this.setAttribute(n,i),this._$Em=null}}_$AK(t,e){let r=this.constructor,n=r._$Eh.get(t);if(n!==void 0&&this._$Em!==n){let i=r.getPropertyOptions(n),o=typeof i.converter=="function"?{fromAttribute:i.converter}:i.converter?.fromAttribute!==void 0?i.converter:V;this._$Em=n;let u=o.fromAttribute(e,i.type);this[n]=u??this._$Ej?.get(n)??u,this._$Em=null}}requestUpdate(t,e,r,n=!1,i){if(t!==void 0){let o=this.constructor;if(n===!1&&(i=this[t]),r??=o.getPropertyOptions(t),!((r.hasChanged??ut)(i,e)||r.useDefault&&r.reflect&&i===this._$Ej?.get(t)&&!this.hasAttribute(o._$Eu(t,r))))return;this.C(t,e,r)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(t,e,{useDefault:r,reflect:n,wrapped:i},o){r&&!(this._$Ej??=new Map).has(t)&&(this._$Ej.set(t,o??e??this[t]),i!==!0||o!==void 0)||(this._$AL.has(t)||(this.hasUpdated||r||(e=void 0),this._$AL.set(t,e)),n===!0&&this._$Em!==t&&(this._$Eq??=new Set).add(t))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(e){Promise.reject(e)}let t=this.scheduleUpdate();return t!=null&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[n,i]of this._$Ep)this[n]=i;this._$Ep=void 0}let r=this.constructor.elementProperties;if(r.size>0)for(let[n,i]of r){let{wrapped:o}=i,u=this[n];o!==!0||this._$AL.has(n)||u===void 0||this.C(n,void 0,i,u)}}let t=!1,e=this._$AL;try{t=this.shouldUpdate(e),t?(this.willUpdate(e),this._$EO?.forEach(r=>r.hostUpdate?.()),this.update(e)):this._$EM()}catch(r){throw t=!1,this._$EM(),r}t&&this._$AE(e)}willUpdate(t){}_$AE(t){this._$EO?.forEach(e=>e.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return!0}update(t){this._$Eq&&=this._$Eq.forEach(e=>this._$ET(e,this[e])),this._$EM()}updated(t){}firstUpdated(t){}};b.elementStyles=[],b.shadowRootOptions={mode:"open"},b[R("elementProperties")]=new Map,b[R("finalized")]=new Map,zt?.({ReactiveElement:b}),(q.reactiveElementVersions??=[]).push("2.1.2");var J=globalThis,pt=s=>s,D=J.trustedTypes,ct=D?D.createPolicy("lit-html",{createHTML:s=>s}):void 0,bt="$lit$",y=`lit$${Math.random().toFixed(9).slice(2)}$`,yt="?"+y,Bt=`<${yt}>`,$=document,O=()=>$.createComment(""),N=s=>s===null||typeof s!="object"&&typeof s!="function",X=Array.isArray,Vt=s=>X(s)||typeof s?.[Symbol.iterator]=="function",F=`[ 	
\f\r]`,P=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,ht=/-->/g,dt=/>/g,x=RegExp(`>|${F}(?:([^\\s"'>=/]+)(${F}*=${F}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),mt=/'/g,ft=/"/g,_t=/^(?:script|style|textarea|title)$/i,Q=s=>(t,...e)=>({_$litType$:s,strings:t,values:e}),m=Q(1),Ft=Q(2),te=Q(3),C=Symbol.for("lit-noChange"),c=Symbol.for("lit-nothing"),gt=new WeakMap,v=$.createTreeWalker($,129);function xt(s,t){if(!X(s)||!s.hasOwnProperty("raw"))throw Error("invalid template strings array");return ct!==void 0?ct.createHTML(t):t}var jt=(s,t)=>{let e=s.length-1,r=[],n,i=t===2?"<svg>":t===3?"<math>":"",o=P;for(let u=0;u<e;u++){let a=s[u],h,p,l=-1,f=0;for(;f<a.length&&(o.lastIndex=f,p=o.exec(a),p!==null);)f=o.lastIndex,o===P?p[1]==="!--"?o=ht:p[1]!==void 0?o=dt:p[2]!==void 0?(_t.test(p[2])&&(n=RegExp("</"+p[2],"g")),o=x):p[3]!==void 0&&(o=x):o===x?p[0]===">"?(o=n??P,l=-1):p[1]===void 0?l=-2:(l=o.lastIndex-p[2].length,h=p[1],o=p[3]===void 0?x:p[3]==='"'?ft:mt):o===ft||o===mt?o=x:o===ht||o===dt?o=P:(o=x,n=void 0);let d=o===x&&s[u+1].startsWith("/>")?" ":"";i+=o===P?a+Bt:l>=0?(r.push(h),a.slice(0,l)+bt+a.slice(l)+y+d):a+y+(l===-2?u:d)}return[xt(s,i+(s[e]||"<?>")+(t===2?"</svg>":t===3?"</math>":"")),r]},L=class s{constructor({strings:t,_$litType$:e},r){let n;this.parts=[];let i=0,o=0,u=t.length-1,a=this.parts,[h,p]=jt(t,e);if(this.el=s.createElement(h,r),v.currentNode=this.el.content,e===2||e===3){let l=this.el.content.firstChild;l.replaceWith(...l.childNodes)}for(;(n=v.nextNode())!==null&&a.length<u;){if(n.nodeType===1){if(n.hasAttributes())for(let l of n.getAttributeNames())if(l.endsWith(bt)){let f=p[o++],d=n.getAttribute(l).split(y),g=/([.?@])?(.*)/.exec(f);a.push({type:1,index:i,name:g[2],strings:d,ctor:g[1]==="."?K:g[1]==="?"?Y:g[1]==="@"?W:T}),n.removeAttribute(l)}else l.startsWith(y)&&(a.push({type:6,index:i}),n.removeAttribute(l));if(_t.test(n.tagName)){let l=n.textContent.split(y),f=l.length-1;if(f>0){n.textContent=D?D.emptyScript:"";for(let d=0;d<f;d++)n.append(l[d],O()),v.nextNode(),a.push({type:2,index:++i});n.append(l[f],O())}}}else if(n.nodeType===8)if(n.data===yt)a.push({type:2,index:i});else{let l=-1;for(;(l=n.data.indexOf(y,l+1))!==-1;)a.push({type:7,index:i}),l+=y.length-1}i++}}static createElement(t,e){let r=$.createElement("template");return r.innerHTML=t,r}};function E(s,t,e=s,r){if(t===C)return t;let n=r!==void 0?e._$Co?.[r]:e._$Cl,i=N(t)?void 0:t._$litDirective$;return n?.constructor!==i&&(n?._$AO?.(!1),i===void 0?n=void 0:(n=new i(s),n._$AT(s,e,r)),r!==void 0?(e._$Co??=[])[r]=n:e._$Cl=n),n!==void 0&&(t=E(s,n._$AS(s,t.values),n,r)),t}var j=class{constructor(t,e){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=e}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){let{el:{content:e},parts:r}=this._$AD,n=(t?.creationScope??$).importNode(e,!0);v.currentNode=n;let i=v.nextNode(),o=0,u=0,a=r[0];for(;a!==void 0;){if(o===a.index){let h;a.type===2?h=new M(i,i.nextSibling,this,t):a.type===1?h=new a.ctor(i,a.name,a.strings,this,t):a.type===6&&(h=new G(i,this,t)),this._$AV.push(h),a=r[++u]}o!==a?.index&&(i=v.nextNode(),o++)}return v.currentNode=$,n}p(t){let e=0;for(let r of this._$AV)r!==void 0&&(r.strings!==void 0?(r._$AI(t,r,e),e+=r.strings.length-2):r._$AI(t[e])),e++}},M=class s{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,e,r,n){this.type=2,this._$AH=c,this._$AN=void 0,this._$AA=t,this._$AB=e,this._$AM=r,this.options=n,this._$Cv=n?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode,e=this._$AM;return e!==void 0&&t?.nodeType===11&&(t=e.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,e=this){t=E(this,t,e),N(t)?t===c||t==null||t===""?(this._$AH!==c&&this._$AR(),this._$AH=c):t!==this._$AH&&t!==C&&this._(t):t._$litType$!==void 0?this.$(t):t.nodeType!==void 0?this.T(t):Vt(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==c&&N(this._$AH)?this._$AA.nextSibling.data=t:this.T($.createTextNode(t)),this._$AH=t}$(t){let{values:e,_$litType$:r}=t,n=typeof r=="number"?this._$AC(t):(r.el===void 0&&(r.el=L.createElement(xt(r.h,r.h[0]),this.options)),r);if(this._$AH?._$AD===n)this._$AH.p(e);else{let i=new j(n,this),o=i.u(this.options);i.p(e),this.T(o),this._$AH=i}}_$AC(t){let e=gt.get(t.strings);return e===void 0&&gt.set(t.strings,e=new L(t)),e}k(t){X(this._$AH)||(this._$AH=[],this._$AR());let e=this._$AH,r,n=0;for(let i of t)n===e.length?e.push(r=new s(this.O(O()),this.O(O()),this,this.options)):r=e[n],r._$AI(i),n++;n<e.length&&(this._$AR(r&&r._$AB.nextSibling,n),e.length=n)}_$AR(t=this._$AA.nextSibling,e){for(this._$AP?.(!1,!0,e);t!==this._$AB;){let r=pt(t).nextSibling;pt(t).remove(),t=r}}setConnected(t){this._$AM===void 0&&(this._$Cv=t,this._$AP?.(t))}},T=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,e,r,n,i){this.type=1,this._$AH=c,this._$AN=void 0,this.element=t,this.name=e,this._$AM=n,this.options=i,r.length>2||r[0]!==""||r[1]!==""?(this._$AH=Array(r.length-1).fill(new String),this.strings=r):this._$AH=c}_$AI(t,e=this,r,n){let i=this.strings,o=!1;if(i===void 0)t=E(this,t,e,0),o=!N(t)||t!==this._$AH&&t!==C,o&&(this._$AH=t);else{let u=t,a,h;for(t=i[0],a=0;a<i.length-1;a++)h=E(this,u[r+a],e,a),h===C&&(h=this._$AH[a]),o||=!N(h)||h!==this._$AH[a],h===c?t=c:t!==c&&(t+=(h??"")+i[a+1]),this._$AH[a]=h}o&&!n&&this.j(t)}j(t){t===c?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}},K=class extends T{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===c?void 0:t}},Y=class extends T{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==c)}},W=class extends T{constructor(t,e,r,n,i){super(t,e,r,n,i),this.type=5}_$AI(t,e=this){if((t=E(this,t,e,0)??c)===C)return;let r=this._$AH,n=t===c&&r!==c||t.capture!==r.capture||t.once!==r.once||t.passive!==r.passive,i=t!==c&&(r===c||n);n&&this.element.removeEventListener(this.name,this,r),i&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}},G=class{constructor(t,e,r){this.element=t,this.type=6,this._$AN=void 0,this._$AM=e,this.options=r}get _$AU(){return this._$AM._$AU}_$AI(t){E(this,t)}};var Kt=J.litHtmlPolyfillSupport;Kt?.(L,M),(J.litHtmlVersions??=[]).push("3.3.3");var vt=(s,t,e)=>{let r=e?.renderBefore??t,n=r._$litPart$;if(n===void 0){let i=e?.renderBefore??null;r._$litPart$=n=new M(t.insertBefore(O(),i),i,void 0,e??{})}return n._$AI(s),n};var Z=globalThis,_=class extends b{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let t=super.createRenderRoot();return this.renderOptions.renderBefore??=t.firstChild,t}update(t){let e=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=vt(e,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return C}};_._$litElement$=!0,_.finalized=!0,Z.litElementHydrateSupport?.({LitElement:_});var Yt=Z.litElementPolyfillSupport;Yt?.({LitElement:_});(Z.litElementVersions??=[]).push("4.2.2");var S={change:"ut-change",blur:"ut-blur",validity:"ut-validity",resize:"ut-resize",request:"ut-request"};var de={valueBytes:256*1024,uploadBytes:25*1024*1024,minHeight:24,maxHeight:2e3,maxPendingRequests:8,messageLength:500},me={moduleBytes:2*1024*1024,zipBytes:3*1024*1024,manifestBytes:64*1024,props:50,context:20,valueSchemaBytes:16*1024};function $t(s,t,e,r){return s[e]!==void 0?s[e]:t&&t[e]!==void 0?t[e]:r}function A(s){return{detail:s,bubbles:!0,composed:!0}}function Ct(s,t){if(s)return{valid:!0};let e=typeof t=="string"?t.slice(0,500):"";return e?{valid:!1,message:e}:{valid:!1}}function St(s,t,e){let r=[s,t?e:null].filter(n=>typeof n=="string"&&n.trim()!=="");return r.length?r.join(" "):null}function kt(s,t,e,r=""){let n=s?.tokens?.[t];return typeof n=="string"&&n?n:e?.trim()||r}function Et(s,t,e,r=3e4){return new Promise((n,i)=>{let o=!1,u=setTimeout(()=>a(()=>i(new Error(`${t} request timed out`))),r);function a(p){o||(o=!0,clearTimeout(u),p())}let h={kind:t,payload:e,resolve:p=>a(()=>n(p)),reject:p=>a(()=>i(p instanceof Error?p:new Error(String(p))))};s.dispatchEvent(new CustomEvent(S.request,A(h)))})}var Tt={value:{attribute:!1},disabled:{type:Boolean,reflect:!0},readonly:{type:Boolean,reflect:!0},required:{type:Boolean},invalid:{type:Boolean,reflect:!0},error:{attribute:!1},props:{attribute:!1},theme:{attribute:!1},locale:{attribute:!1},context:{attribute:!1},label:{attribute:!1},description:{attribute:!1}};var At=Symbol("ut-last-validity");function Wt(s,t){if(typeof getComputedStyle!="function")return null;try{return getComputedStyle(s).getPropertyValue(`--${t}`)}catch{return null}}function wt(s){let t=s.properties??{};class e extends s{static{this.properties={...t,...Tt}}get#t(){return this}get utLabel(){let n=this.#t.label;return typeof n=="string"?n:""}get utDescription(){let n=this.#t;return St(n.description??null,!!n.invalid,n.error??null)}prop(n,i){let o=this[n];return $t({[n]:o},this.#t.props,n,i)}emitChange(n){let i=n===void 0?null:n;this.#t.value=i,this.dispatchEvent(new CustomEvent(S.change,A({value:i})))}emitBlur(){this.dispatchEvent(new CustomEvent(S.blur,A({})))}setValidity(n,i){let o=Ct(n,i),u=JSON.stringify(o),a=this;a[At]!==u&&(a[At]=u,this.dispatchEvent(new CustomEvent(S.validity,A(o))))}emitResize(n){!Number.isFinite(n)||n<=0||this.dispatchEvent(new CustomEvent(S.resize,A({height:Math.ceil(n)})))}request(n,i){return Et(this,n,i)}themeToken(n,i=""){return kt(this.#t.theme??null,n,Wt(this,n),i)}}return e}var Gt=k`
  :host {
    --_primary: var(--ut-primary, #2f5fd0);
    --_on-primary: var(--ut-on-primary, #ffffff);
    --_primary-text: var(--ut-primary-text, #2a4fa8);
    --_primary-light: var(--ut-primary-light, #e7eefc);
    --_text: var(--ut-text, #1b1916);
    --_muted: var(--ut-muted-text, #5f5a50);
    --_surface: var(--ut-surface, #f5f3ee);
    --_card: var(--ut-card, #ffffff);
    --_border: var(--ut-border, #cfc9bb);
    --_input-bg: var(--ut-input-bg, #ffffff);
    --_input-text: var(--ut-input-text, #1b1916);
    --_focus: var(--ut-focus-ring, var(--_primary));
    --_error: var(--ut-error, #b42318);
    --_success: var(--ut-success, #2f7a4b);
    --_radius: var(--ut-radius, 8px);
    display: block;
    box-sizing: border-box;
    font-family: var(--ut-font-family, system-ui, -apple-system, 'Segoe UI', sans-serif);
    font-size: var(--ut-font-size, 14px);
    line-height: 1.45;
    color: var(--_text);
    -webkit-tap-highlight-color: transparent;
  }
  :host([data-mode='dark']) {
    --_primary: var(--ut-primary, #7ea2ff);
    --_on-primary: var(--ut-on-primary, #0d1220);
    --_primary-text: var(--ut-primary-text, #a9c0ff);
    --_primary-light: var(--ut-primary-light, #1d2740);
    --_text: var(--ut-text, #eceae4);
    --_muted: var(--ut-muted-text, #a8a397);
    --_surface: var(--ut-surface, #1c1b19);
    --_card: var(--ut-card, #262522);
    --_border: var(--ut-border, #4a473f);
    --_input-bg: var(--ut-input-bg, #1f1e1b);
    --_input-text: var(--ut-input-text, #eceae4);
    --_error: var(--ut-error, #f97066);
    --_success: var(--ut-success, #6fcf97);
  }
  :host([hidden]) { display: none; }
  *, *::before, *::after { box-sizing: border-box; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  :focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
  button { font: inherit; color: inherit; }
  .muted { color: var(--_muted); }
  .error-text { color: var(--_error); }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; animation: none !important; }
  }
`,U=class extends wt(_){static{this.styles=Gt}constructor(){super(),this.value=null,this.disabled=!1,this.readonly=!1,this.required=!1,this.invalid=!1,this.error=null,this.props={},this.theme=null,this.locale="en",this.context=null,this.label="",this.description=null}get locked(){return!!(this.readonly||this.disabled)}contextValue(t){let e=this.context?.fields,r=e&&Object.prototype.hasOwnProperty.call(e,t)?e[t]:null;return r===void 0?null:r}textProp(t,e=""){let r=this.prop(t,e);return typeof r=="string"&&r.trim()?r.trim():e}numberProp(t,e,r=-1/0,n=1/0){let i=this.prop(t,e),o=typeof i=="number"?i:Number(i);return Number.isFinite(o)?Math.min(n,Math.max(r,o)):e}boolProp(t,e=!1){let r=this.prop(t,e);return typeof r=="boolean"?r:r==="true"?!0:r==="false"?!1:e}validate(){return null}updated(t){super.updated(t),t.has("theme")&&(this.theme?.mode==="dark"?this.dataset.mode="dark":delete this.dataset.mode);let e=this.validate();this.setValidity(!e,e??void 0)}};function Rt(s,t){customElements.get(s)||customElements.define(s,t)}function tt(s,t,e){try{return new Intl.NumberFormat(t||"en",e).format(s)}catch{return String(s)}}function Pt(s){if(!Number.isFinite(s))return 0;let t=String(s);if(t.includes("e-"))return Number(t.split("e-")[1])||0;let e=t.indexOf(".");return e<0?0:t.length-e-1}var et=class extends U{static{this.properties={draft:{state:!0}}}static{this.styles=[U.styles,k`
    .wrap { display: flex; flex-direction: column; gap: 2px; }
    .row { display: flex; align-items: center; gap: 12px; }
    .track-area { position: relative; flex: 1; min-width: 0; }
    .track-area.has-bubble { padding-top: 30px; }
    .affix { align-self: flex-start; margin-top: -2px; }
    .has-bubble + .affix { margin-top: 28px; }
    input[type='range'] {
      -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 32px; margin: 0;
      background: transparent; cursor: pointer; touch-action: pan-y;
    }
    input[type='range']:focus { outline: none; }
    input[type='range']:focus-visible { outline: none; }
    input[type='range']::-webkit-slider-runnable-track {
      height: 6px; border-radius: 999px; border: 1px solid var(--_border);
      background: linear-gradient(to right, var(--_fill) 0 var(--_pct), var(--_surface) var(--_pct) 100%);
    }
    input[type='range']::-moz-range-track {
      height: 6px; border-radius: 999px; border: 1px solid var(--_border); background: var(--_surface);
    }
    input[type='range']::-moz-range-progress { height: 6px; border-radius: 999px; background: var(--_fill); }
    input[type='range']::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none; width: 24px; height: 24px; margin-top: -10px; border-radius: 50%;
      background: var(--_thumb-bg); border: 2px solid var(--_primary); box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
      transition: transform 0.12s ease;
    }
    input[type='range']::-moz-range-thumb {
      width: 20px; height: 20px; border-radius: 50%; background: var(--_thumb-bg); border: 2px solid var(--_primary);
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
    }
    input[type='range']:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--_card), 0 0 0 5px var(--_focus); }
    input[type='range']:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 3px var(--_card), 0 0 0 5px var(--_focus); }
    input[type='range']:active::-webkit-slider-thumb { transform: scale(1.1); }
    .unset input[type='range']::-webkit-slider-thumb { border-style: dashed; border-color: var(--_muted); }
    .unset input[type='range']::-moz-range-thumb { border-style: dashed; border-color: var(--_muted); }
    :host([invalid]) input[type='range']::-webkit-slider-runnable-track { border-color: var(--_error); }
    :host([disabled]) .wrap { opacity: 0.55; }
    :host([readonly]) input[type='range'], :host([disabled]) input[type='range'] { cursor: default; }
    .bubble {
      position: absolute; top: 0; left: var(--_thumb-x); transform: translateX(calc(var(--_pct) * -1));
      padding: 2px 8px; border-radius: 6px; font-weight: 600; font-size: 0.93em; line-height: 20px; white-space: nowrap;
      background: var(--_primary); color: var(--_on-primary); font-variant-numeric: tabular-nums; pointer-events: none;
    }
    .unset .bubble { background: var(--_card); color: var(--_muted); border: 1px dashed var(--_border); font-weight: 500; line-height: 18px; }
    .ends, .marks { display: flex; justify-content: space-between; color: var(--_muted); font-size: 0.86em; }
    .marks { position: relative; height: 1.4em; margin: 0 12px; }
    .mark { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
    .mark:first-child { transform: translateX(-12px); }
    .mark:last-child { transform: translateX(calc(-100% + 12px)); }
    .mark.on { color: var(--_text); font-weight: 600; }
    .ends { padding: 0 2px; }
    .number {
      width: 88px; flex: none; height: 36px; padding: 0 8px; border: 1px solid var(--_border); border-radius: var(--_radius);
      background: var(--_input-bg); color: var(--_input-text); font: inherit; font-variant-numeric: tabular-nums;
    }
    .number:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; border-color: var(--_focus); }
    :host([invalid]) .number { border-color: var(--_error); }
    .affix { display: inline-flex; align-items: center; gap: 4px; color: var(--_muted); flex: none; }
    .row { align-items: flex-start; }
    .status { color: var(--_muted); font-size: 0.86em; }
    @media (max-width: 420px) { .number { width: 72px; } }
  `]}constructor(){super(),this.draft=null}get lo(){return this.numberProp("min",0)}get hi(){let t=this.numberProp("max",100);return t>this.lo?t:this.lo+1}get stepSize(){let t=this.numberProp("step",1);return t>0?t:1}get places(){return Math.max(Pt(this.stepSize),Pt(this.lo))}get current(){let t=this.value;if(t==null||t==="")return null;let e=typeof t=="number"?t:Number(t);return Number.isFinite(e)?e:null}get shown(){let t=this.current;if(t!==null)return Math.min(this.hi,Math.max(this.lo,t));let e=this.prop("default_value",null),r=typeof e=="number"?e:e===null||e===""?NaN:Number(e);return Number.isFinite(r)?Math.min(this.hi,Math.max(this.lo,r)):this.lo}get markLabels(){let t=this.prop("marks",[]);return(Array.isArray(t)?t:typeof t=="string"?t.split(/[\n,]/):[]).map(r=>String(r??"").trim()).filter(Boolean).slice(0,12)}fmt(t){let e=Math.min(6,this.places);return`${this.textProp("value_prefix")}${tt(t,this.locale,{minimumFractionDigits:e,maximumFractionDigits:e})}${this.textProp("value_suffix")}`}markAt(t){let e=this.markLabels;if(e.length<2)return e.length===1&&Math.abs(t-this.lo)<1e-9?e[0]:"";let r=(this.hi-this.lo)/(e.length-1),n=Math.round((t-this.lo)/r);return Math.abs(this.lo+n*r-t)<=this.stepSize/2+1e-9?e[n]??"":""}validate(){let t=this.value;if(t==null||t==="")return null;let e=`Choose a value from ${this.fmt(this.lo)} to ${this.fmt(this.hi)}`;if(typeof t!="number"||!Number.isFinite(t)||t<this.lo-1e-9||t>this.hi+1e-9)return e;let r=(t-this.lo)/this.stepSize;return Math.abs(r-Math.round(r))>1e-6?`${e}, in steps of ${tt(this.stepSize,this.locale,{maximumFractionDigits:6})}`:null}snap(t){let e=Math.round((t-this.lo)/this.stepSize),r=Math.min(this.hi,Math.max(this.lo,this.lo+e*this.stepSize));return Number(r.toFixed(Math.min(10,this.places)))}onRange(t){if(this.locked)return;let e=Number(t.target.value);Number.isFinite(e)&&(this.draft=null,e!==this.current&&this.emitChange(this.snap(e)))}onRangeKey(t){this.locked||this.current!==null||(t.key==="Enter"||t.key===" ")&&(t.preventDefault(),this.emitChange(this.snap(this.shown)))}onNumberInput(t){if(this.locked)return;let e=t.target.value;if(this.draft=e,e.trim()===""){this.emitChange(null);return}let r=Number(e);Number.isFinite(r)&&this.emitChange(r)}onNumberCommit(){this.draft=null}onFocusOut(t){this.renderRoot.contains(t.relatedTarget)||this.emitBlur()}render(){let t=this.lo,e=this.hi,r=this.current,n=this.shown,i=r===null,o=(n-t)/(e-t)*100,u=this.markLabels,a=this.boolProp("show_value",!0),h=this.boolProp("show_input",!1)&&!this.locked,p=this.markAt(n),l=this.fmt(n),f=i?`Not set${this.locked?"":`, starts at ${l}`}`:p&&p!==l?`${l}, ${p}`:l,d=this.textProp("value_prefix"),g=this.textProp("value_suffix"),rt=this.utLabel||"Value",Ot=`--_pct:${o}%;--_thumb-x:calc(${o}% + ${12-o*.24}px);--_fill:${i?"var(--_surface)":"var(--_primary)"};--_thumb-bg:var(--_card)`;return m`
      <div class="wrap ${i?"unset":""}" style=${Ot} @focusout=${this.onFocusOut}>
        <div class="row">
          <div class="track-area ${a?"has-bubble":""}">
            ${a?m`<span class="bubble" aria-hidden="true">${i?this.locked?"Not set":`${l} · not set`:l}</span>`:c}
            <input type="range" min=${t} max=${e} step=${this.stepSize} .value=${String(n)}
              aria-label=${rt} aria-valuetext=${f}
              aria-describedby=${this.utDescription?"desc":c}
              aria-required=${this.required?"true":"false"} aria-invalid=${this.invalid?"true":"false"}
              aria-readonly=${this.readonly?"true":c}
              ?disabled=${this.locked}
              @input=${this.onRange} @change=${this.onRange} @keydown=${this.onRangeKey} />
            ${u.length?m`<div class="marks" aria-hidden="true">
                ${u.map((nt,Nt)=>m`<span class="mark ${nt===p?"on":""}" style="left:${u.length===1?0:Nt/(u.length-1)*100}%">${nt}</span>`)}
              </div>`:m`<div class="ends" aria-hidden="true"><span>${this.fmt(t)}</span><span>${this.fmt(e)}</span></div>`}
          </div>
          ${h?m`<span class="affix">
              ${d?m`<span aria-hidden="true">${d}</span>`:c}
              <input class="number" type="number" inputmode="decimal" min=${t} max=${e} step=${this.stepSize}
                .value=${this.draft??(r===null?"":String(r))} placeholder=${i?String(n):""}
                aria-label=${`${rt}, exact value${d||g?` (${[d,g].filter(Boolean).join(" … ")})`:""}`}
                aria-invalid=${this.invalid?"true":"false"}
                @input=${this.onNumberInput} @change=${this.onNumberCommit} @blur=${this.onNumberCommit} />
              ${g?m`<span aria-hidden="true">${g}</span>`:c}
            </span>`:c}
        </div>
        ${i&&!a?m`<span class="status" aria-hidden="true">${this.locked?"Not set":"Not set yet — move the slider to choose"}</span>`:c}
      </div>
      ${this.utDescription?m`<span id="desc" class="sr-only">${this.utDescription}</span>`:c}
    `}};Rt("ut-slider",et);export{et as UtSlider};
/*! Bundled license information:

@lit/reactive-element/css-tag.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit/reactive-element/reactive-element.js:
lit-html/lit-html.js:
lit-element/lit-element.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/is-server.js:
  (**
   * @license
   * Copyright 2022 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/

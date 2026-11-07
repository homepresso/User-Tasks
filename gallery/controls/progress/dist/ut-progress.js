/*! ut-progress 1.2.0 | UserTasks gallery form control | Apache-2.0 | bundles @lit/reactive-element 2.1.2 (BSD-3-Clause), lit 3.3.3 (BSD-3-Clause), lit-element 4.2.2 (BSD-3-Clause), lit-html 3.3.3 (BSD-3-Clause) */
var D=globalThis,B=D.ShadowRoot&&(D.ShadyCSS===void 0||D.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,W=Symbol(),ct=new WeakMap,P=class{constructor(t,e,r){if(this._$cssResult$=!0,r!==W)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=e}get styleSheet(){let t=this.o,e=this.t;if(B&&t===void 0){let r=e!==void 0&&e.length===1;r&&(t=ct.get(e)),t===void 0&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),r&&ct.set(e,t))}return t}toString(){return this.cssText}},pt=s=>new P(typeof s=="string"?s:s+"",void 0,W),T=(s,...t)=>{let e=s.length===1?s[0]:t.reduce((r,n,o)=>r+(i=>{if(i._$cssResult$===!0)return i.cssText;if(typeof i=="number")return i;throw Error("Value passed to 'css' function must be a 'css' function result: "+i+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(n)+s[o+1],s[0]);return new P(e,s,W)},ut=(s,t)=>{if(B)s.adoptedStyleSheets=t.map(e=>e instanceof CSSStyleSheet?e:e.styleSheet);else for(let e of t){let r=document.createElement("style"),n=D.litNonce;n!==void 0&&r.setAttribute("nonce",n),r.textContent=e.cssText,s.appendChild(r)}},G=B?s=>s:s=>s instanceof CSSStyleSheet?(t=>{let e="";for(let r of t.cssRules)e+=r.cssText;return pt(e)})(s):s;var{is:qt,defineProperty:Dt,getOwnPropertyDescriptor:Bt,getOwnPropertyNames:zt,getOwnPropertySymbols:Vt,getPrototypeOf:jt}=Object,z=globalThis,dt=z.trustedTypes,Ft=dt?dt.emptyScript:"",Kt=z.reactiveElementPolyfillSupport,O=(s,t)=>s,J={toAttribute(s,t){switch(t){case Boolean:s=s?Ft:null;break;case Object:case Array:s=s==null?s:JSON.stringify(s)}return s},fromAttribute(s,t){let e=s;switch(t){case Boolean:e=s!==null;break;case Number:e=s===null?null:Number(s);break;case Object:case Array:try{e=JSON.parse(s)}catch{e=null}}return e}},mt=(s,t)=>!qt(s,t),ht={attribute:!0,type:String,converter:J,reflect:!1,useDefault:!1,hasChanged:mt};Symbol.metadata??=Symbol("metadata"),z.litPropertyMetadata??=new WeakMap;var y=class extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??=[]).push(t)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,e=ht){if(e.state&&(e.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(t)&&((e=Object.create(e)).wrapped=!0),this.elementProperties.set(t,e),!e.noAccessor){let r=Symbol(),n=this.getPropertyDescriptor(t,r,e);n!==void 0&&Dt(this.prototype,t,n)}}static getPropertyDescriptor(t,e,r){let{get:n,set:o}=Bt(this.prototype,t)??{get(){return this[e]},set(i){this[e]=i}};return{get:n,set(i){let l=n?.call(this);o?.call(this,i),this.requestUpdate(t,l,r)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)??ht}static _$Ei(){if(this.hasOwnProperty(O("elementProperties")))return;let t=jt(this);t.finalize(),t.l!==void 0&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties)}static finalize(){if(this.hasOwnProperty(O("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(O("properties"))){let e=this.properties,r=[...zt(e),...Vt(e)];for(let n of r)this.createProperty(n,e[n])}let t=this[Symbol.metadata];if(t!==null){let e=litPropertyMetadata.get(t);if(e!==void 0)for(let[r,n]of e)this.elementProperties.set(r,n)}this._$Eh=new Map;for(let[e,r]of this.elementProperties){let n=this._$Eu(e,r);n!==void 0&&this._$Eh.set(n,e)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(t){let e=[];if(Array.isArray(t)){let r=new Set(t.flat(1/0).reverse());for(let n of r)e.unshift(G(n))}else t!==void 0&&e.push(G(t));return e}static _$Eu(t,e){let r=e.attribute;return r===!1?void 0:typeof r=="string"?r:typeof t=="string"?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(t=>t(this))}addController(t){(this._$EO??=new Set).add(t),this.renderRoot!==void 0&&this.isConnected&&t.hostConnected?.()}removeController(t){this._$EO?.delete(t)}_$E_(){let t=new Map,e=this.constructor.elementProperties;for(let r of e.keys())this.hasOwnProperty(r)&&(t.set(r,this[r]),delete this[r]);t.size>0&&(this._$Ep=t)}createRenderRoot(){let t=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return ut(t,this.constructor.elementStyles),t}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(t=>t.hostConnected?.())}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach(t=>t.hostDisconnected?.())}attributeChangedCallback(t,e,r){this._$AK(t,r)}_$ET(t,e){let r=this.constructor.elementProperties.get(t),n=this.constructor._$Eu(t,r);if(n!==void 0&&r.reflect===!0){let o=(r.converter?.toAttribute!==void 0?r.converter:J).toAttribute(e,r.type);this._$Em=t,o==null?this.removeAttribute(n):this.setAttribute(n,o),this._$Em=null}}_$AK(t,e){let r=this.constructor,n=r._$Eh.get(t);if(n!==void 0&&this._$Em!==n){let o=r.getPropertyOptions(n),i=typeof o.converter=="function"?{fromAttribute:o.converter}:o.converter?.fromAttribute!==void 0?o.converter:J;this._$Em=n;let l=i.fromAttribute(e,o.type);this[n]=l??this._$Ej?.get(n)??l,this._$Em=null}}requestUpdate(t,e,r,n=!1,o){if(t!==void 0){let i=this.constructor;if(n===!1&&(o=this[t]),r??=i.getPropertyOptions(t),!((r.hasChanged??mt)(o,e)||r.useDefault&&r.reflect&&o===this._$Ej?.get(t)&&!this.hasAttribute(i._$Eu(t,r))))return;this.C(t,e,r)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(t,e,{useDefault:r,reflect:n,wrapped:o},i){r&&!(this._$Ej??=new Map).has(t)&&(this._$Ej.set(t,i??e??this[t]),o!==!0||i!==void 0)||(this._$AL.has(t)||(this.hasUpdated||r||(e=void 0),this._$AL.set(t,e)),n===!0&&this._$Em!==t&&(this._$Eq??=new Set).add(t))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(e){Promise.reject(e)}let t=this.scheduleUpdate();return t!=null&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[n,o]of this._$Ep)this[n]=o;this._$Ep=void 0}let r=this.constructor.elementProperties;if(r.size>0)for(let[n,o]of r){let{wrapped:i}=o,l=this[n];i!==!0||this._$AL.has(n)||l===void 0||this.C(n,void 0,o,l)}}let t=!1,e=this._$AL;try{t=this.shouldUpdate(e),t?(this.willUpdate(e),this._$EO?.forEach(r=>r.hostUpdate?.()),this.update(e)):this._$EM()}catch(r){throw t=!1,this._$EM(),r}t&&this._$AE(e)}willUpdate(t){}_$AE(t){this._$EO?.forEach(e=>e.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return!0}update(t){this._$Eq&&=this._$Eq.forEach(e=>this._$ET(e,this[e])),this._$EM()}updated(t){}firstUpdated(t){}};y.elementStyles=[],y.shadowRootOptions={mode:"open"},y[O("elementProperties")]=new Map,y[O("finalized")]=new Map,Kt?.({ReactiveElement:y}),(z.reactiveElementVersions??=[]).push("2.1.2");var nt=globalThis,ft=s=>s,V=nt.trustedTypes,gt=V?V.createPolicy("lit-html",{createHTML:s=>s}):void 0,vt="$lit$",_=`lit$${Math.random().toFixed(9).slice(2)}$`,Ct="?"+_,Yt=`<${Ct}>`,C=document,L=()=>C.createComment(""),M=s=>s===null||typeof s!="object"&&typeof s!="function",st=Array.isArray,Wt=s=>st(s)||typeof s?.[Symbol.iterator]=="function",Q=`[ 	
\f\r]`,N=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,yt=/-->/g,bt=/>/g,$=RegExp(`>|${Q}(?:([^\\s"'>=/]+)(${Q}*=${Q}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),_t=/'/g,xt=/"/g,wt=/^(?:script|style|textarea|title)$/i,ot=s=>(t,...e)=>({_$litType$:s,strings:t,values:e}),g=ot(1),I=ot(2),se=ot(3),w=Symbol.for("lit-noChange"),d=Symbol.for("lit-nothing"),$t=new WeakMap,v=C.createTreeWalker(C,129);function St(s,t){if(!st(s)||!s.hasOwnProperty("raw"))throw Error("invalid template strings array");return gt!==void 0?gt.createHTML(t):t}var Gt=(s,t)=>{let e=s.length-1,r=[],n,o=t===2?"<svg>":t===3?"<math>":"",i=N;for(let l=0;l<e;l++){let a=s[l],c,p,u=-1,h=0;for(;h<a.length&&(i.lastIndex=h,p=i.exec(a),p!==null);)h=i.lastIndex,i===N?p[1]==="!--"?i=yt:p[1]!==void 0?i=bt:p[2]!==void 0?(wt.test(p[2])&&(n=RegExp("</"+p[2],"g")),i=$):p[3]!==void 0&&(i=$):i===$?p[0]===">"?(i=n??N,u=-1):p[1]===void 0?u=-2:(u=i.lastIndex-p[2].length,c=p[1],i=p[3]===void 0?$:p[3]==='"'?xt:_t):i===xt||i===_t?i=$:i===yt||i===bt?i=N:(i=$,n=void 0);let m=i===$&&s[l+1].startsWith("/>")?" ":"";o+=i===N?a+Yt:u>=0?(r.push(c),a.slice(0,u)+vt+a.slice(u)+_+m):a+_+(u===-2?l:m)}return[St(s,o+(s[e]||"<?>")+(t===2?"</svg>":t===3?"</math>":"")),r]},U=class s{constructor({strings:t,_$litType$:e},r){let n;this.parts=[];let o=0,i=0,l=t.length-1,a=this.parts,[c,p]=Gt(t,e);if(this.el=s.createElement(c,r),v.currentNode=this.el.content,e===2||e===3){let u=this.el.content.firstChild;u.replaceWith(...u.childNodes)}for(;(n=v.nextNode())!==null&&a.length<l;){if(n.nodeType===1){if(n.hasAttributes())for(let u of n.getAttributeNames())if(u.endsWith(vt)){let h=p[i++],m=n.getAttribute(u).split(_),f=/([.?@])?(.*)/.exec(h);a.push({type:1,index:o,name:f[2],strings:m,ctor:f[1]==="."?X:f[1]==="?"?tt:f[1]==="@"?et:E}),n.removeAttribute(u)}else u.startsWith(_)&&(a.push({type:6,index:o}),n.removeAttribute(u));if(wt.test(n.tagName)){let u=n.textContent.split(_),h=u.length-1;if(h>0){n.textContent=V?V.emptyScript:"";for(let m=0;m<h;m++)n.append(u[m],L()),v.nextNode(),a.push({type:2,index:++o});n.append(u[h],L())}}}else if(n.nodeType===8)if(n.data===Ct)a.push({type:2,index:o});else{let u=-1;for(;(u=n.data.indexOf(_,u+1))!==-1;)a.push({type:7,index:o}),u+=_.length-1}o++}}static createElement(t,e){let r=C.createElement("template");return r.innerHTML=t,r}};function A(s,t,e=s,r){if(t===w)return t;let n=r!==void 0?e._$Co?.[r]:e._$Cl,o=M(t)?void 0:t._$litDirective$;return n?.constructor!==o&&(n?._$AO?.(!1),o===void 0?n=void 0:(n=new o(s),n._$AT(s,e,r)),r!==void 0?(e._$Co??=[])[r]=n:e._$Cl=n),n!==void 0&&(t=A(s,n._$AS(s,t.values),n,r)),t}var Z=class{constructor(t,e){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=e}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){let{el:{content:e},parts:r}=this._$AD,n=(t?.creationScope??C).importNode(e,!0);v.currentNode=n;let o=v.nextNode(),i=0,l=0,a=r[0];for(;a!==void 0;){if(i===a.index){let c;a.type===2?c=new H(o,o.nextSibling,this,t):a.type===1?c=new a.ctor(o,a.name,a.strings,this,t):a.type===6&&(c=new rt(o,this,t)),this._$AV.push(c),a=r[++l]}i!==a?.index&&(o=v.nextNode(),i++)}return v.currentNode=C,n}p(t){let e=0;for(let r of this._$AV)r!==void 0&&(r.strings!==void 0?(r._$AI(t,r,e),e+=r.strings.length-2):r._$AI(t[e])),e++}},H=class s{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,e,r,n){this.type=2,this._$AH=d,this._$AN=void 0,this._$AA=t,this._$AB=e,this._$AM=r,this.options=n,this._$Cv=n?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode,e=this._$AM;return e!==void 0&&t?.nodeType===11&&(t=e.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,e=this){t=A(this,t,e),M(t)?t===d||t==null||t===""?(this._$AH!==d&&this._$AR(),this._$AH=d):t!==this._$AH&&t!==w&&this._(t):t._$litType$!==void 0?this.$(t):t.nodeType!==void 0?this.T(t):Wt(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==d&&M(this._$AH)?this._$AA.nextSibling.data=t:this.T(C.createTextNode(t)),this._$AH=t}$(t){let{values:e,_$litType$:r}=t,n=typeof r=="number"?this._$AC(t):(r.el===void 0&&(r.el=U.createElement(St(r.h,r.h[0]),this.options)),r);if(this._$AH?._$AD===n)this._$AH.p(e);else{let o=new Z(n,this),i=o.u(this.options);o.p(e),this.T(i),this._$AH=o}}_$AC(t){let e=$t.get(t.strings);return e===void 0&&$t.set(t.strings,e=new U(t)),e}k(t){st(this._$AH)||(this._$AH=[],this._$AR());let e=this._$AH,r,n=0;for(let o of t)n===e.length?e.push(r=new s(this.O(L()),this.O(L()),this,this.options)):r=e[n],r._$AI(o),n++;n<e.length&&(this._$AR(r&&r._$AB.nextSibling,n),e.length=n)}_$AR(t=this._$AA.nextSibling,e){for(this._$AP?.(!1,!0,e);t!==this._$AB;){let r=ft(t).nextSibling;ft(t).remove(),t=r}}setConnected(t){this._$AM===void 0&&(this._$Cv=t,this._$AP?.(t))}},E=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,e,r,n,o){this.type=1,this._$AH=d,this._$AN=void 0,this.element=t,this.name=e,this._$AM=n,this.options=o,r.length>2||r[0]!==""||r[1]!==""?(this._$AH=Array(r.length-1).fill(new String),this.strings=r):this._$AH=d}_$AI(t,e=this,r,n){let o=this.strings,i=!1;if(o===void 0)t=A(this,t,e,0),i=!M(t)||t!==this._$AH&&t!==w,i&&(this._$AH=t);else{let l=t,a,c;for(t=o[0],a=0;a<o.length-1;a++)c=A(this,l[r+a],e,a),c===w&&(c=this._$AH[a]),i||=!M(c)||c!==this._$AH[a],c===d?t=d:t!==d&&(t+=(c??"")+o[a+1]),this._$AH[a]=c}i&&!n&&this.j(t)}j(t){t===d?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}},X=class extends E{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===d?void 0:t}},tt=class extends E{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==d)}},et=class extends E{constructor(t,e,r,n,o){super(t,e,r,n,o),this.type=5}_$AI(t,e=this){if((t=A(this,t,e,0)??d)===w)return;let r=this._$AH,n=t===d&&r!==d||t.capture!==r.capture||t.once!==r.once||t.passive!==r.passive,o=t!==d&&(r===d||n);n&&this.element.removeEventListener(this.name,this,r),o&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}},rt=class{constructor(t,e,r){this.element=t,this.type=6,this._$AN=void 0,this._$AM=e,this.options=r}get _$AU(){return this._$AM._$AU}_$AI(t){A(this,t)}};var Jt=nt.litHtmlPolyfillSupport;Jt?.(U,H),(nt.litHtmlVersions??=[]).push("3.3.3");var Tt=(s,t,e)=>{let r=e?.renderBefore??t,n=r._$litPart$;if(n===void 0){let o=e?.renderBefore??null;r._$litPart$=n=new H(t.insertBefore(L(),o),o,void 0,e??{})}return n._$AI(s),n};var it=globalThis,x=class extends y{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let t=super.createRenderRoot();return this.renderOptions.renderBefore??=t.firstChild,t}update(t){let e=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=Tt(e,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return w}};x._$litElement$=!0,x.finalized=!0,it.litElementHydrateSupport?.({LitElement:x});var Qt=it.litElementPolyfillSupport;Qt?.({LitElement:x});(it.litElementVersions??=[]).push("4.2.2");var S={change:"ut-change",blur:"ut-blur",validity:"ut-validity",resize:"ut-resize",request:"ut-request"};var ye={valueBytes:256*1024,uploadBytes:25*1024*1024,minHeight:24,maxHeight:2e3,maxPendingRequests:8,messageLength:500},be={moduleBytes:2*1024*1024,zipBytes:3*1024*1024,manifestBytes:64*1024,props:50,context:20,valueSchemaBytes:16*1024};function At(s,t,e,r){return s[e]!==void 0?s[e]:t&&t[e]!==void 0?t[e]:r}function k(s){return{detail:s,bubbles:!0,composed:!0}}function Et(s,t){if(s)return{valid:!0};let e=typeof t=="string"?t.slice(0,500):"";return e?{valid:!1,message:e}:{valid:!1}}function kt(s,t,e){let r=[s,t?e:null].filter(n=>typeof n=="string"&&n.trim()!=="");return r.length?r.join(" "):null}function Rt(s,t,e,r=""){let n=s?.tokens?.[t];return typeof n=="string"&&n?n:e?.trim()||r}function Pt(s,t,e,r=3e4){return new Promise((n,o)=>{let i=!1,l=setTimeout(()=>a(()=>o(new Error(`${t} request timed out`))),r);function a(p){i||(i=!0,clearTimeout(l),p())}let c={kind:t,payload:e,resolve:p=>a(()=>n(p)),reject:p=>a(()=>o(p instanceof Error?p:new Error(String(p))))};s.dispatchEvent(new CustomEvent(S.request,k(c)))})}var Ot={value:{attribute:!1},disabled:{type:Boolean,reflect:!0},readonly:{type:Boolean,reflect:!0},required:{type:Boolean},invalid:{type:Boolean,reflect:!0},error:{attribute:!1},props:{attribute:!1},theme:{attribute:!1},locale:{attribute:!1},context:{attribute:!1},label:{attribute:!1},description:{attribute:!1}};var Nt=Symbol("ut-last-validity");function Zt(s,t){if(typeof getComputedStyle!="function")return null;try{return getComputedStyle(s).getPropertyValue(`--${t}`)}catch{return null}}function Lt(s){let t=s.properties??{};class e extends s{static{this.properties={...t,...Ot}}get#t(){return this}get utLabel(){let n=this.#t.label;return typeof n=="string"?n:""}get utDescription(){let n=this.#t;return kt(n.description??null,!!n.invalid,n.error??null)}prop(n,o){let i=this[n];return At({[n]:i},this.#t.props,n,o)}emitChange(n){let o=n===void 0?null:n;this.#t.value=o,this.dispatchEvent(new CustomEvent(S.change,k({value:o})))}emitBlur(){this.dispatchEvent(new CustomEvent(S.blur,k({})))}setValidity(n,o){let i=Et(n,o),l=JSON.stringify(i),a=this;a[Nt]!==l&&(a[Nt]=l,this.dispatchEvent(new CustomEvent(S.validity,k(i))))}emitResize(n){!Number.isFinite(n)||n<=0||this.dispatchEvent(new CustomEvent(S.resize,k({height:Math.ceil(n)})))}request(n,o){return Pt(this,n,o)}themeToken(n,o=""){return Rt(this.#t.theme??null,n,Zt(this,n),o)}}return e}var Xt=T`
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
`,q=class extends Lt(x){static{this.styles=Xt}constructor(){super(),this.value=null,this.disabled=!1,this.readonly=!1,this.required=!1,this.invalid=!1,this.error=null,this.props={},this.theme=null,this.locale="en",this.context=null,this.label="",this.description=null}get locked(){return!!(this.readonly||this.disabled)}contextValue(t){let e=this.context?.fields,r=e&&Object.prototype.hasOwnProperty.call(e,t)?e[t]:null;return r===void 0?null:r}textProp(t,e=""){let r=this.prop(t,e);return typeof r=="string"&&r.trim()?r.trim():e}numberProp(t,e,r=-1/0,n=1/0){let o=this.prop(t,e),i=typeof o=="number"?o:Number(o);return Number.isFinite(i)?Math.min(n,Math.max(r,i)):e}boolProp(t,e=!1){let r=this.prop(t,e);return typeof r=="boolean"?r:r==="true"?!0:r==="false"?!1:e}validate(){return null}updated(t){super.updated(t),t.has("theme")&&(this.theme?.mode==="dark"?this.dataset.mode="dark":delete this.dataset.mode);let e=this.validate();this.setValidity(!e,e??void 0)}};function Ut(s,t){customElements.get(s)||customElements.define(s,t)}var Mt=0;function Ht(s="ut"){return Mt+=1,`${s}-${Mt}`}function at(s,t,e){try{return new Intl.NumberFormat(t||"en",e).format(s)}catch{return String(s)}}function j(s){if(s==null)return"";if(typeof s=="string")return s;if(typeof s=="number"||typeof s=="boolean")return String(s);if(Array.isArray(s))return s.map(j).join(", ");try{return JSON.stringify(s)}catch{return String(s)}}function F(s){if(typeof s=="number")return Number.isFinite(s)?s:null;if(typeof s=="string"&&s.trim()!==""){let t=Number(s.trim().replace(/[,\s%]/g,""));return Number.isFinite(t)?t:null}return Array.isArray(s)?s.length:null}var lt=class extends q{constructor(){super(...arguments);this.base=Ht("progress")}static{this.styles=[q.styles,T`
    .wrap { container-type: inline-size; }
    .top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
    .label { color: var(--_text); }
    .pct { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--_text); }
    .status { font-size: 0.86em; color: var(--_tone); font-weight: 600; }
    .track { height: 10px; border-radius: 999px; background: var(--_surface); box-shadow: inset 0 0 0 1px var(--_border); overflow: hidden; }
    .fill { height: 100%; border-radius: 999px; background: var(--_tone); transition: width 0.4s ease; min-width: 0; }
    .ring { display: flex; align-items: center; gap: 14px; }
    .ring svg { flex: none; }
    .ring .bg { stroke: var(--_surface); }
    .ring .edge { stroke: var(--_border); }
    .ring .fg { stroke: var(--_tone); transition: stroke-dashoffset 0.4s ease; }
    .ring text { fill: var(--_text); font-weight: 600; font-family: inherit; }
    .ring .side { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .steps-head { margin-bottom: 8px; color: var(--_text); }
    .steps-head strong { font-weight: 600; }
    ol { list-style: none; margin: 0; padding: 0; display: flex; }
    li { flex: 1 1 0; min-width: 0; position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 0 4px; }
    li::before { content: ''; position: absolute; top: 13px; right: 50%; width: 100%; height: 2px; background: var(--_border); z-index: 0; }
    li:first-child::before { display: none; }
    li.done::before, li.current::before { background: var(--_tone); }
    .mark { position: relative; z-index: 1; width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.86em; font-weight: 600; border: 2px solid var(--_border); background: var(--_card); color: var(--_muted); }
    li.done .mark { background: var(--_tone); border-color: var(--_tone); color: var(--_on-primary); }
    li.current .mark { border-color: var(--_tone); color: var(--_text); box-shadow: 0 0 0 3px var(--_primary-light); }
    .mark svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .name { font-size: 0.86em; color: var(--_muted); overflow-wrap: anywhere; }
    li.current .name { color: var(--_text); font-weight: 600; }
    li.done .name { color: var(--_text); }
    @container (max-width: 460px) {
      ol { flex-direction: column; gap: 10px; }
      li { flex-direction: row; text-align: left; gap: 10px; padding: 0; }
      li::before { top: auto; bottom: 50%; right: auto; left: 13px; width: 2px; height: calc(100% + 10px); }
      .name { font-size: 0.93em; }
    }
    :host([disabled]) .wrap { opacity: 0.6; }
  `]}stepNames(){let e=this.prop("steps",[]);return Array.isArray(e)?e.map(r=>String(r??"").trim()).filter(Boolean).slice(0,20):[]}model(){let e=this.textProp("appearance","bar"),r=e==="steps"?this.stepNames():[],n=this.contextValue("current")??this.prop("current_value",null),o=this.contextValue("total")??this.prop("total_value",null),i=F(n);if(r.length&&i===null&&typeof n=="string"){let b=r.findIndex(K=>K.toLowerCase()===n.trim().toLowerCase());b>=0&&(i=b+1)}let l=r.length?r.length:F(o);(l===null||l<=0)&&(l=100);let a=Math.max(0,Math.min(l,i??0)),c=Math.round(a/l*1e3)/10,p=this.prop("warn_below",null),u=this.prop("good_above",null),h=F(p),m=F(u),f=h!==null&&c<h?"warn":m!==null&&c>=m?"good":"normal";return{appearance:e,steps:r,value:a,total:l,pct:c,tone:f,hasCurrent:i!==null}}labelText(e){let r=this.textProp("unit",""),n=a=>at(a,this.locale,{maximumFractionDigits:2}),o=this.textProp("label_template",e.appearance==="steps"?"":"{{current}} of {{total}} {{unit}}"),i=e.steps[Math.max(0,Math.round(e.value)-1)]??"",l={current:n(e.value),total:n(e.total),unit:r,percent:`${n(e.pct)}%`,remaining:n(Math.max(0,e.total-e.value)),step:i};return o.replace(/\{\{\s*(\w+)\s*\}\}/g,(a,c)=>l[c]??"").replace(/\s+/g," ").trim()}render(){let e=this.model(),r=e.tone==="warn"?"var(--_error)":e.tone==="good"?"var(--_success)":"var(--_primary)",n=this.boolProp("show_percentage",!0),o=this.labelText(e),i=`${at(e.pct,this.locale,{maximumFractionDigits:1})}%`,l=e.tone==="warn"?"Needs attention":e.tone==="good"?"On track":"",a=[o,i,l].filter(Boolean).join(", "),c=this.utLabel||"Progress",p=this.utDescription?g`<span id=${`${this.base}-desc`} class="sr-only">${this.utDescription}</span>`:d,u=this.utDescription?`${this.base}-desc`:d,h=`--_tone:${r}`;if(e.appearance==="steps"&&e.steps.length){let f=Math.max(0,Math.min(e.steps.length,Math.round(e.value))),b=f?`Step ${f} of ${e.steps.length}: ${e.steps[f-1]}`:`Not started (${e.steps.length} steps)`;return g`<div class="wrap" style=${h}>
        <div class="steps-head"><strong>${b}</strong>${o?g` <span class="muted">· ${o}</span>`:d}</div>
        <ol aria-label=${`${c}: ${b}`} aria-describedby=${u}>
          ${e.steps.map((K,It)=>{let Y=It+1,R=Y<f?"done":Y===f?"current":"todo";return g`<li class=${R} aria-current=${R==="current"?"step":d}>
              <span class="mark" aria-hidden="true">${R==="done"?g`<svg viewBox="0 0 24 24">${I`<path d="M5 12.5l4.5 4.5L19 7.5"/>`}</svg>`:Y}</span>
              <span class="name">${K}<span class="sr-only">${R==="done"?", completed":R==="current"?", current step":", not started"}</span></span>
            </li>`})}
        </ol>${p}</div>`}let m={max:j(e.total),now:j(e.value)};if(e.appearance==="ring"){let b=2*Math.PI*26;return g`<div class="wrap ring" style=${h}>
        <svg width="68" height="68" viewBox="0 0 68 68" role="progressbar" aria-label=${c} aria-valuemin="0" aria-valuemax=${m.max}
          aria-valuenow=${m.now} aria-valuetext=${a} aria-describedby=${u}>
          ${I`<circle class="edge" cx="34" cy="34" r="${31}" fill="none" stroke-width="1"/>
          <circle class="bg" cx="34" cy="34" r="${26}" fill="none" stroke-width="8"/>
          <circle class="fg" cx="34" cy="34" r="${26}" fill="none" stroke-width="8" stroke-linecap="round"
            stroke-dasharray="${b}" stroke-dashoffset="${b*(1-e.pct/100)}" transform="rotate(-90 34 34)"/>
          ${n?I`<text x="34" y="34" text-anchor="middle" dominant-baseline="central" font-size="13">${Math.round(e.pct)}%</text>`:d}`}
        </svg>
        <div class="side" aria-hidden="true">
          ${o?g`<span class="label">${o}</span>`:d}
          ${l?g`<span class="status">${l}</span>`:d}
        </div>${p}</div>`}return g`<div class="wrap" style=${h}>
      <div class="top" aria-hidden="true">
        <span class="label">${o}${l?g` <span class="status">· ${l}</span>`:d}</span>
        ${n?g`<span class="pct">${i}</span>`:d}
      </div>
      <div class="track" role="progressbar" aria-label=${c} aria-valuemin="0" aria-valuemax=${m.max} aria-valuenow=${m.now}
        aria-valuetext=${a} aria-describedby=${u}>
        <div class="fill" style=${`width:${e.pct}%`}></div>
      </div>${p}</div>`}};Ut("ut-progress",lt);export{lt as UtProgress};
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

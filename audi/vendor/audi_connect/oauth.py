"""OAuth2/OIDC login flow for Audi Connect — 13-step authentication."""

import json
import uuid
import base64
import os
import re
import logging
from datetime import datetime, timezone
from hashlib import sha256
from urllib.parse import urlparse, parse_qs, urlencode
from typing import Any, Optional

import hmac
from bs4 import BeautifulSoup

from .api import AudiAPI
from .endpoints import cariad_url
from .exceptions import AuthenticationError, CountryNotSupportedError

_LOGGER = logging.getLogger(__name__)

DEVICE_CODE_SCOPE = "openid mbb profile badge cars dealers vin"


class AudiOAuth:
    """Handles the full 13-step OAuth2/OIDC login flow for Audi Connect.

    Reverse-engineered from the Android myAudi app v4.31.0.
    Produces 3 tokens: IDK (CARIAD bearer), AZS (Audi), and MBB (VW Group).
    """

    def __init__(self, api: AudiAPI, country: str):
        self._api = api
        self._country = country or "DE"
        self._device_context: dict[str, str] | None = None

    # --- HTML form helpers ---

    @staticmethod
    def _get_hidden_html_input_form_data(response: str, form_data: dict) -> dict:
        html = BeautifulSoup(response, "html.parser")
        form_inputs = html.find_all("input", attrs={"type": "hidden"})
        for form_input in form_inputs:
            name = form_input.get("name")
            form_data[name] = form_input.get("value")
        return form_data

    @staticmethod
    def _get_post_url(response: str, url: str) -> str:
        html = BeautifulSoup(response, "html.parser")
        form_tag = html.find("form")
        action = form_tag.get("action")
        if action.startswith("http"):
            return action
        elif action.startswith("/"):
            url_parts = urlparse(url)
            return url_parts.scheme + "://" + url_parts.netloc + action
        else:
            raise AuthenticationError("Unknown form action: " + action)

    def _get_cariad_url(self, path_and_query: str, **kwargs) -> str:
        # Thin wrapper so existing tests calling oauth._get_cariad_url(...) keep passing.
        return cariad_url(self._country, path_and_query, **kwargs)

    @staticmethod
    def _calculate_x_qmauth() -> str:
        """Compute X-QMAuth header using HMAC-SHA256.

        Uses a secret extracted from the myAudi Android APK. The timestamp
        is divided by 100 to create 100-second windows, ensuring the same
        HMAC value is produced for requests within the same window.
        """
        gmtime_100sec = int(
            datetime.now(timezone.utc).timestamp() / 100
        )
        # Secret key extracted from myAudi Android app v4.31.0 (obfuscated as byte array)
        xqmauth_secret = bytes(
            [
                26, 256 - 74, 256 - 103, 37, 256 - 84, 23, 256 - 102, 256 - 86,
                78, 256 - 125, 256 - 85, 256 - 26, 113, 256 - 87, 71, 109,
                23, 100, 24, 256 - 72, 91, 256 - 41, 6, 256 - 15,
                67, 108, 256 - 95, 91, 256 - 26, 71, 256 - 104, 256 - 100,
            ]
        )
        xqmauth_val = hmac.new(
            xqmauth_secret,
            str(gmtime_100sec).encode("ascii", "ignore"),
            digestmod="sha256",
        ).hexdigest()
        return "v1:01da27b0:" + xqmauth_val

    # --- Main login flow ---

    async def login(self, user: str, password: str) -> dict:
        """Execute the full 13-step OAuth2 login flow.

        Returns a dict with all tokens and OAuth state needed by the client.
        """
        self._api.use_token(None)
        self._api.set_xclient_id(None)

        # Step 1: Get market configuration
        _LOGGER.debug("Step 1: Fetching market configuration...")
        markets_json = await self._api.request(
            "GET",
            "https://content.app.my.audi.com/service/mobileapp/configurations/markets",
            None,
        )
        if self._country.upper() not in markets_json["countries"]["countrySpecifications"]:
            raise CountryNotSupportedError(
                f"Country '{self._country}' not found in Audi markets. "
                f"Available: {list(markets_json['countries']['countrySpecifications'].keys())}"
            )
        language = markets_json["countries"]["countrySpecifications"][
            self._country.upper()
        ]["defaultLanguage"]

        # Step 2: Get dynamic config
        _LOGGER.debug("Step 2: Fetching dynamic configuration...")
        marketcfg_url = (
            f"https://content.app.my.audi.com/service/mobileapp/configurations/"
            f"market/{self._country}/{language}?v=4.23.1"
        )
        openidcfg_url = self._get_cariad_url("/auth/v1/idk/oidc/openid-configuration")
        marketcfg_json = await self._api.request("GET", marketcfg_url, None)

        client_id = "09b6cbec-cd19-4589-82fd-363dfa8c24da@apps_vw-dilab_com"
        if "idkClientIDAndroidLive" in marketcfg_json:
            client_id = marketcfg_json["idkClientIDAndroidLive"]

        authorization_server_base_url = self._get_cariad_url("/login/v1/audi")
        if "authorizationServerBaseURLLive" in marketcfg_json:
            authorization_server_base_url = marketcfg_json[
                "myAudiAuthorizationServerProxyServiceURLProduction"
            ]

        mbb_oauth_base_url = "https://mbboauth-1d.prd.ece.vwg-connect.com/mbbcoauth"
        if "mbbOAuthBaseURLLive" in marketcfg_json:
            mbb_oauth_base_url = marketcfg_json["mbbOAuthBaseURLLive"]

        # Step 3: Get OpenID configuration
        _LOGGER.debug("Step 3: Fetching OpenID configuration...")
        openidcfg_json = await self._api.request("GET", openidcfg_url, None)

        authorization_endpoint = "https://identity.vwgroup.io/oidc/v1/authorize"
        if "authorization_endpoint" in openidcfg_json:
            authorization_endpoint = openidcfg_json["authorization_endpoint"]

        token_endpoint = self._get_cariad_url("/auth/v1/idk/oidc/token")
        if "token_endpoint" in openidcfg_json:
            token_endpoint = openidcfg_json["token_endpoint"]

        # Step 4: Generate PKCE challenge
        _LOGGER.debug("Step 4: Generating PKCE code challenge...")
        code_verifier = str(
            base64.urlsafe_b64encode(os.urandom(32)), "utf-8"
        ).strip("=")
        code_challenge = str(
            base64.urlsafe_b64encode(
                sha256(code_verifier.encode("ascii", "ignore")).digest()
            ),
            "utf-8",
        ).strip("=")

        state = str(uuid.uuid4())
        nonce = str(uuid.uuid4())

        # Step 5: Get login page
        _LOGGER.debug("Step 5: Requesting login page...")
        headers = {
            "Accept": "application/json",
            "Accept-Charset": "utf-8",
            "X-App-Version": AudiAPI.HDR_XAPP_VERSION,
            "X-App-Name": "myAudi",
            "User-Agent": AudiAPI.HDR_USER_AGENT,
        }
        idk_data = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": "myaudi:///",
            "scope": "address profile badge birthdate birthplace nationalIdentifier nationality profession email vin phone nickname name picture mbb gallery openid",
            "state": state,
            "nonce": nonce,
            "prompt": "login",
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "ui_locales": "de-de de",
        }
        idk_rsp, idk_rsptxt = await self._api.request(
            "GET", authorization_endpoint, None,
            headers=headers, params=idk_data, rsp_wtxt=True,
        )

        # Step 6: Submit email
        _LOGGER.debug("Step 6: Submitting email...")
        submit_data = self._get_hidden_html_input_form_data(idk_rsptxt, {"email": user})
        submit_url = self._get_post_url(idk_rsptxt, authorization_endpoint)

        email_rsp, email_rsptxt = await self._api.request(
            "POST", submit_url, submit_data,
            headers=headers, cookies=idk_rsp.cookies,
            allow_redirects=True, rsp_wtxt=True,
        )

        # Step 7: Submit password
        _LOGGER.debug("Step 7: Submitting password...")
        regex_res = re.findall('"hmac"\\s*:\\s*"[0-9a-fA-F]+"', email_rsptxt)
        if regex_res:
            submit_url = submit_url.replace("identifier", "authenticate")
            submit_data["hmac"] = regex_res[0].split(":")[1].strip('"')
            submit_data["password"] = password
        else:
            submit_data = self._get_hidden_html_input_form_data(
                email_rsptxt, {"password": password}
            )
            submit_url = self._get_post_url(email_rsptxt, submit_url)

        pw_rsp, pw_rsptxt = await self._api.request(
            "POST", submit_url, submit_data,
            headers=headers, cookies=idk_rsp.cookies,
            allow_redirects=False, rsp_wtxt=True,
        )

        # Step 8: Follow redirects to get authorization code
        _LOGGER.debug("Step 8: Following redirects...")
        fwd1_rsp, _ = await self._api.request(
            "GET", pw_rsp.headers["Location"], None,
            headers=headers, cookies=idk_rsp.cookies,
            allow_redirects=False, rsp_wtxt=True,
        )
        fwd2_rsp, _ = await self._api.request(
            "GET", fwd1_rsp.headers["Location"], None,
            headers=headers, cookies=idk_rsp.cookies,
            allow_redirects=False, rsp_wtxt=True,
        )
        codeauth_rsp, _ = await self._api.request(
            "GET", fwd2_rsp.headers["Location"], None,
            headers=headers, cookies=fwd2_rsp.cookies,
            allow_redirects=False, rsp_wtxt=True,
        )

        authcode_parsed = urlparse(
            codeauth_rsp.headers["Location"][len("myaudi:///?"):]
        )
        authcode_strings = parse_qs(authcode_parsed.path)

        # Step 9: Exchange code for IDK bearer token
        _LOGGER.debug("Step 9: Exchanging authorization code for tokens...")
        headers = {
            "Accept": "application/json",
            "Accept-Charset": "utf-8",
            "X-QMAuth": self._calculate_x_qmauth(),
            "User-Agent": AudiAPI.HDR_USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        }
        tokenreq_data = {
            "client_id": client_id,
            "grant_type": "authorization_code",
            "code": authcode_strings["code"][0],
            "redirect_uri": "myaudi:///",
            "response_type": "token id_token",
            "code_verifier": code_verifier,
        }
        encoded_tokenreq_data = urlencode(tokenreq_data, encoding="utf-8").replace("+", "%20")
        _, bearer_token_rsptxt = await self._api.request(
            "POST", token_endpoint, encoded_tokenreq_data,
            headers=headers, allow_redirects=False, rsp_wtxt=True,
        )
        bearer_token_json = json.loads(bearer_token_rsptxt)

        return await self._finalize_session(
            bearer_token_json,
            {
                "client_id": client_id,
                "token_endpoint": token_endpoint,
                "authorization_server_base_url": authorization_server_base_url,
                "mbb_oauth_base_url": mbb_oauth_base_url,
                "language": language,
            },
        )

    async def _discover_endpoints(self) -> dict[str, str]:
        """Resolve the dynamic Audi/OIDC endpoints used by device login."""
        self._api.use_token(None)
        self._api.set_xclient_id(None)

        markets_json = await self._api.request(
            "GET",
            "https://content.app.my.audi.com/service/mobileapp/configurations/markets",
            None,
        )
        specifications = markets_json["countries"]["countrySpecifications"]
        if self._country.upper() not in specifications:
            raise CountryNotSupportedError(
                f"Country '{self._country}' not found in Audi markets"
            )
        language = specifications[self._country.upper()]["defaultLanguage"]

        marketcfg_url = (
            "https://content.app.my.audi.com/service/mobileapp/configurations/"
            f"market/{self._country}/{language}?v=4.23.1"
        )
        marketcfg_json = await self._api.request("GET", marketcfg_url, None)
        openidcfg_url = marketcfg_json.get(
            "idkLoginServiceConfigurationURLProduction",
            self._get_cariad_url("/auth/v1/idk/oidc/openid-configuration"),
        )
        openidcfg_json = await self._api.request("GET", openidcfg_url, None)

        return {
            "client_id": marketcfg_json.get(
                "idkClientIDAndroidLive",
                "09b6cbec-cd19-4589-82fd-363dfa8c24da@apps_vw-dilab_com",
            ),
            "token_endpoint": openidcfg_json.get(
                "token_endpoint",
                self._get_cariad_url("/auth/v1/idk/oidc/token"),
            ),
            "device_authorization_endpoint": openidcfg_json.get(
                "device_authorization_endpoint",
                "https://identity.vwgroup.io/oidc/v1/device_authorization",
            ),
            "authorization_server_base_url": marketcfg_json.get(
                "myAudiAuthorizationServerProxyServiceURLProduction",
                self._get_cariad_url("/login/v1/audi"),
            ),
            "mbb_oauth_base_url": marketcfg_json.get(
                "mbbOAuthBaseURLLive",
                "https://mbboauth-1d.prd.ece.vwg-connect.com/mbbcoauth",
            ),
            "language": language,
        }

    async def request_device_code(self) -> dict[str, Any]:
        """Start Audi's RFC 8628 device authorization grant."""
        self._device_context = await self._discover_endpoints()
        headers = {
            "Accept": "application/json",
            "Accept-Charset": "utf-8",
            "X-App-Version": AudiAPI.HDR_XAPP_VERSION,
            "X-App-Name": "myAudi",
            "User-Agent": AudiAPI.HDR_USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        }
        encoded = urlencode(
            {
                "client_id": self._device_context["client_id"],
                "scope": DEVICE_CODE_SCOPE,
            },
            encoding="utf-8",
        ).replace("+", "%20")
        _, response_text = await self._api.request(
            "POST",
            self._device_context["device_authorization_endpoint"],
            encoded,
            headers=headers,
            allow_redirects=False,
            rsp_wtxt=True,
        )
        result = json.loads(response_text)
        if "device_code" not in result:
            error = result.get("error_description") or result.get("error") or "unknown"
            raise AuthenticationError(f"Device authorization failed: {error}")
        return result

    async def poll_device_token(
        self, device_code: str
    ) -> tuple[str, dict[str, Any] | None]:
        """Poll once for device approval and finalize the Audi session on success."""
        if self._device_context is None:
            raise AuthenticationError("Device authorization was not started")

        headers = {
            "Accept": "application/json",
            "Accept-Charset": "utf-8",
            "User-Agent": AudiAPI.HDR_USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        }
        encoded = urlencode(
            {
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "client_id": self._device_context["client_id"],
                "device_code": device_code,
            },
            encoding="utf-8",
        ).replace("+", "%20")
        _, response_text = await self._api.request(
            "POST",
            self._device_context["token_endpoint"],
            encoded,
            headers=headers,
            allow_redirects=False,
            rsp_wtxt=True,
        )
        result = json.loads(response_text)
        if "access_token" in result:
            return "ok", await self._finalize_session(result, self._device_context)

        status = {
            "authorization_pending": "authorization_pending",
            "slow_down": "slow_down",
            "expired_token": "expired",
            "access_denied": "denied",
        }.get(result.get("error"), "error")
        return status, None

    async def login_with_refresh_token(self, refresh_token: str) -> dict[str, Any]:
        """Create a new Audi session from a device-grant refresh token."""
        context = await self._discover_endpoints()
        headers = {
            "Accept": "application/json",
            "Accept-Charset": "utf-8",
            "User-Agent": AudiAPI.HDR_USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        }
        encoded = urlencode(
            {
                "client_id": context["client_id"],
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "response_type": "token id_token",
            },
            encoding="utf-8",
        ).replace("+", "%20")
        _, response_text = await self._api.request(
            "POST",
            context["token_endpoint"],
            encoded,
            headers=headers,
            allow_redirects=False,
            rsp_wtxt=True,
        )
        result = json.loads(response_text)
        if "access_token" not in result:
            error = result.get("error_description") or result.get("error") or "unknown"
            raise AuthenticationError(f"Audi refresh token rejected: {error}")
        return await self._finalize_session(result, context)

    async def _finalize_session(
        self, bearer_token: dict[str, Any], context: dict[str, str]
    ) -> dict[str, Any]:
        """Derive AZS and MBB tokens from an approved IDK bearer token."""
        headers = {
            "Accept": "application/json",
            "Accept-Charset": "utf-8",
            "X-App-Version": AudiAPI.HDR_XAPP_VERSION,
            "X-App-Name": "myAudi",
            "User-Agent": AudiAPI.HDR_USER_AGENT,
            "Content-Type": "application/json; charset=utf-8",
        }
        _, response_text = await self._api.request(
            "POST",
            context["authorization_server_base_url"] + "/token",
            json.dumps(
                {
                    "token": bearer_token["access_token"],
                    "grant_type": "id_token",
                    "stage": "live",
                    "config": "myaudi",
                }
            ),
            headers=headers,
            allow_redirects=False,
            rsp_wtxt=True,
        )
        audi_token = json.loads(response_text)

        headers = {
            "Accept": "application/json",
            "Accept-Charset": "utf-8",
            "User-Agent": AudiAPI.HDR_USER_AGENT,
            "Content-Type": "application/json; charset=utf-8",
        }
        registration_response, response_text = await self._api.request(
            "POST",
            context["mbb_oauth_base_url"] + "/mobile/register/v1",
            json.dumps(
                {
                    "client_name": "SM-A405FN",
                    "platform": "google",
                    "client_brand": "Audi",
                    "appName": "myAudi",
                    "appVersion": AudiAPI.HDR_XAPP_VERSION,
                    "appId": "de.myaudi.mobile.assistant",
                }
            ),
            headers=headers,
            allow_redirects=False,
            rsp_wtxt=True,
        )
        xclient_id = json.loads(response_text)["client_id"]
        self._api.set_xclient_id(xclient_id)

        headers = {
            "Accept": "application/json",
            "Accept-Charset": "utf-8",
            "User-Agent": AudiAPI.HDR_USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Client-ID": xclient_id,
        }
        encoded = urlencode(
            {
                "grant_type": "id_token",
                "token": bearer_token["id_token"],
                "scope": "sc2:fal",
            },
            encoding="utf-8",
        ).replace("+", "%20")
        _, response_text = await self._api.request(
            "POST",
            context["mbb_oauth_base_url"] + "/mobile/oauth2/v1/token",
            encoded,
            headers=headers,
            allow_redirects=False,
            rsp_wtxt=True,
        )
        mbb_oauth_token = json.loads(response_text)

        if "refresh_token" in mbb_oauth_token:
            encoded = urlencode(
                {
                    "grant_type": "refresh_token",
                    "token": mbb_oauth_token["refresh_token"],
                    "scope": "sc2:fal",
                },
                encoding="utf-8",
            ).replace("+", "%20")
            _, response_text = await self._api.request(
                "POST",
                context["mbb_oauth_base_url"] + "/mobile/oauth2/v1/token",
                encoded,
                headers=headers,
                allow_redirects=False,
                cookies=registration_response.cookies,
                rsp_wtxt=True,
            )
            vw_token = json.loads(response_text)
        else:
            vw_token = mbb_oauth_token

        return {
            "bearer_token": bearer_token,
            "audi_token": audi_token,
            "vw_token": vw_token,
            "mbb_oauth_token": mbb_oauth_token,
            "xclient_id": xclient_id,
            "client_id": context["client_id"],
            "token_endpoint": context["token_endpoint"],
            "authorization_server_base_url": context[
                "authorization_server_base_url"
            ],
            "mbb_oauth_base_url": context["mbb_oauth_base_url"],
            "language": context["language"],
        }

    async def refresh_tokens(
        self,
        mbb_oauth_token: dict,
        bearer_token: dict,
        client_id: str,
        token_endpoint: str,
        authorization_server_base_url: str,
        mbb_oauth_base_url: str,
        xclient_id: str,
    ) -> dict:
        """Refresh all 3 tokens (MBB, IDK bearer, AZS).

        Returns a dict with fresh bearer_token, audi_token, vw_token, mbb_oauth_token.
        """
        # Refresh MBB token
        headers = {
            "Accept": "application/json",
            "Accept-Charset": "utf-8",
            "User-Agent": AudiAPI.HDR_USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Client-ID": xclient_id,
        }
        mbboauth_refresh_data = {
            "grant_type": "refresh_token",
            "token": mbb_oauth_token["refresh_token"],
            "scope": "sc2:fal",
        }
        encoded = urlencode(mbboauth_refresh_data, encoding="utf-8").replace("+", "%20")
        _, rsptxt = await self._api.request(
            "POST", mbb_oauth_base_url + "/mobile/oauth2/v1/token",
            encoded, headers=headers, allow_redirects=False, rsp_wtxt=True,
        )
        vw_token = json.loads(rsptxt)

        if "refresh_token" in vw_token:
            mbb_oauth_token["refresh_token"] = vw_token["refresh_token"]

        # Refresh IDK bearer token
        headers = {
            "Accept": "application/json",
            "Accept-Charset": "utf-8",
            "X-QMAuth": self._calculate_x_qmauth(),
            "User-Agent": AudiAPI.HDR_USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        }
        tokenreq_data = {
            "client_id": client_id,
            "grant_type": "refresh_token",
            "refresh_token": bearer_token.get("refresh_token"),
            "response_type": "token id_token",
        }
        encoded = urlencode(tokenreq_data, encoding="utf-8").replace("+", "%20")
        _, rsptxt = await self._api.request(
            "POST", token_endpoint, encoded,
            headers=headers, allow_redirects=False, rsp_wtxt=True,
        )
        new_bearer_token = json.loads(rsptxt)

        # Refresh AZS token
        headers = {
            "Accept": "application/json",
            "Accept-Charset": "utf-8",
            "X-App-Version": AudiAPI.HDR_XAPP_VERSION,
            "X-App-Name": "myAudi",
            "User-Agent": AudiAPI.HDR_USER_AGENT,
            "Content-Type": "application/json; charset=utf-8",
        }
        asz_req_data = {
            "token": new_bearer_token["access_token"],
            "grant_type": "id_token",
            "stage": "live",
            "config": "myaudi",
        }
        _, rsptxt = await self._api.request(
            "POST", authorization_server_base_url + "/token",
            json.dumps(asz_req_data), headers=headers,
            allow_redirects=False, rsp_wtxt=True,
        )
        audi_token = json.loads(rsptxt)

        return {
            "bearer_token": new_bearer_token,
            "audi_token": audi_token,
            "vw_token": vw_token,
            "mbb_oauth_token": mbb_oauth_token,
        }

import BigNumber from "bignumber.js";
import _ from "lodash";
import {
  APIError,
  OptimalRates,
  ParaSwap,
  Token,
  Transaction,
  User,
} from "paraswap";
import * as React from "react";
import C3Chart from "react-c3js";
import {
  Button,
  Dropdown,
  Form,
  Icon,
  Image,
  Input,
  Message,
  Segment,
} from "semantic-ui-react";
import LOGO from "./img/logo.png";

const { useMemo, useState, useEffect } = React;

const Web3 = require("web3");
//import {injected, network,} from "./connectors";

const PROVIDER_URL = process.env.PROVIDER_URL;
const API_URL = process.env.API_URL || "https://paraswap.io/api/v1";
const DEFAULT_ALLOWED_SLIPPAGE = 0.005; //0.5%
const REFERRER = require("../package.json").name; //TODO: use the referrer name you like
const PAIR = { from: "ETH", to: "DAI", amount: "1" };

interface SwapperState {
  loading: boolean;
  error: string;
  tokens: Token[];
  srcAmount: string;
  priceRoute?: OptimalRates;
  user?: User;
  payTo?: string;
  tokenFrom?: Token;
  tokenTo?: Token;
  transactionHash?: string;
}

const DefaultState = {
  error: "",
  loading: false,
  tokens: [],
  srcAmount: "1",
  payTo: "",
  transactionHash: "",
};

const provider = new Web3(new Web3.providers.HttpProvider(PROVIDER_URL!));

const isValidAddress = (address: string) => provider.utils.isAddress(address);

const mapTokenToOption = (t: Token) => ({
  key: t.symbol,
  text: t.symbol,
  value: t.symbol,
});

const Swapper: React.FC = () => {
  const [state, setState] = useState<SwapperState>(DefaultState);
  let paraSwap: ParaSwap;

  useEffect(() => {
    getBestPrice(state.srcAmount);
  }, [state.tokenFrom, state.tokenTo, state.priceRoute, state.srcAmount]);

  const updateState = (partialState: Partial<SwapperState>): SwapperState => {
    const stateUpdated = { ...state, ...partialState };
    setState(stateUpdated);
    return stateUpdated;
  };

  const destAmount: string = useMemo((): string => {
    const { priceRoute, tokenTo } = state;

    if (!priceRoute) {
      return "";
    }

    const destAmount = new BigNumber(priceRoute.amount).dividedBy(
      10 ** tokenTo!.decimals
    );

    if (destAmount.isNaN()) {
      return "";
    }

    return destAmount.toFixed();
  }, [state.priceRoute, state.tokenTo]);

  const options = useMemo(() => state.tokens.map(mapTokenToOption), [
    state.tokens,
  ]);

  const setSrcAmount = (value: string) => {
    const srcAmount = getSrcAmount(value);

    updateState({ srcAmount, priceRoute: undefined });
  };

  const onPayToChanged = (e: any) => {
    const payTo = e.target.value;
    updateState({ payTo });

    if (payTo && !isValidAddress(payTo)) {
      updateState({ error: "Invalid pay address" });
    } else {
      updateState({ error: "" });
    }
  };

  const switchTokens = () => {
    const { tokenFrom, tokenTo } = state;
    updateState({ tokenFrom: tokenTo, tokenTo: tokenFrom });
  };

  const updatePair = (fromOrTo: "from" | "to", symbol: string) => {
    if (fromOrTo === "from") {
      if (symbol === state.tokenTo!.symbol) {
        switchTokens();
      }

      const tokenFrom = state.tokens.find((t) => t.symbol === symbol);
      updateState({ tokenFrom, priceRoute: undefined });

      if (symbol.toUpperCase() !== "ETH") {
        getAllowance(tokenFrom!);
      }
    } else {
      if (symbol === state.tokenFrom!.symbol) {
        switchTokens();
      }

      updateState({
        priceRoute: undefined,
        tokenTo: state.tokens.find((t) => t.symbol === symbol),
      });
    }
  };

  const getBestPrice = async (srcAmount: string) => {
    const { tokenFrom, tokenTo } = state;

    try {
      updateState({ error: "", priceRoute: undefined });

      const srcAmountFormatted = new BigNumber(srcAmount).times(
        10 ** tokenFrom!.decimals
      );

      if (
        srcAmountFormatted.isNaN() ||
        srcAmountFormatted.isLessThanOrEqualTo(0)
      ) {
        return;
      }

      updateState({ loading: true });

      const priceRouteOrError = await paraSwap!.getRate(
        tokenFrom!.address,
        tokenTo!.address,
        srcAmountFormatted.toFixed(0)
      );

      if ((priceRouteOrError as APIError).message) {
        updateState({
          error: (priceRouteOrError as APIError).message,
          loading: false,
        });
      }

      const priceRoute = priceRouteOrError as OptimalRates;

      updateState({ loading: false, priceRoute });
    } catch (e) {
      updateState({ error: "Price Feed Error", loading: false });
    }
  };

  const getSrcAmount = (value: string) => {
    const { srcAmount } = state;
    if (_.isNaN(Number(value))) {
      return srcAmount;
    }
    return value;
  };

  const needsAllowance = () => {
    const { tokenFrom, priceRoute } = state;

    if (tokenFrom!.symbol === "ETH") {
      return false;
    }

    return new BigNumber(priceRoute!.amount).isGreaterThan(
      new BigNumber(tokenFrom!.allowance!)
    );
  };

  const getAllowance = async (token: Token) => {
    updateState({ loading: true });
    try {
      const { user } = state;

      const allowance = await paraSwap!.getAllowance(
        user!.address,
        token.address,
        user!.network
      );

      const tokenWithAllowance = new Token(
        token.address,
        token.decimals,
        token.symbol,
        allowance
      );

      updateState({ tokenFrom: tokenWithAllowance, loading: false });
    } catch (e) {
      updateState({ error: e.toString(), loading: false });
    }
  };

  const swapOrPay = async () => {
    const { user, tokenFrom, tokenTo, srcAmount, priceRoute, payTo } = state;

    try {
      updateState({ loading: true, error: "" });

      const _srcAmount = new BigNumber(srcAmount)
        .times(10 ** tokenFrom!.decimals)
        .toFixed(0);

      const minDestinationAmount = new BigNumber(
        priceRoute!.amount
      ).multipliedBy(1 - DEFAULT_ALLOWED_SLIPPAGE);

      const txParams = await paraSwap!.buildTx(
        tokenFrom!.address,
        tokenTo!.address,
        _srcAmount,
        minDestinationAmount.toFixed(),
        priceRoute!,
        user!.address,
        REFERRER,
        payTo
      );

      if ((txParams as APIError).message) {
        return updateState({
          error: (txParams as APIError).message,
          loading: false,
        });
      }

      await provider.eth.sendTransaction(
        txParams as Transaction,
        async (err: any, transactionHash: string) => {
          if (err) {
            return updateState({ error: err.toString(), loading: false });
          }

          console.log("transactionHash", transactionHash);
          updateState({ transactionHash });
        }
      );

      updateState({ loading: false });
    } catch (e) {
      updateState({ error: e.message, loading: false });
      console.error("ERROR", e);
    }
  };

  const setAllowance = async () => {
    const { user, tokenFrom, srcAmount } = state;

    try {
      const amount = new BigNumber(srcAmount)
        .times(10 ** tokenFrom!.decimals)
        .toFixed(0);

      const transactionHash = await paraSwap!.approveToken(
        amount,
        user!.address,
        tokenFrom!.address,
        user!.network
      );

      console.log("transactionHash", transactionHash);
      updateState({ transactionHash });
    } catch (e) {
      updateState({ error: e.toString(), loading: false });
    }
  };

  const bestRoute = useMemo(
    () =>
      (state.priceRoute &&
        state.priceRoute.bestRoute.filter(
          (pr: any) => !!Number(pr.srcAmount)
        )) ||
      [],
    [state.priceRoute]
  );

  const c3Data = useMemo(
    () => ({
      columns: bestRoute.map((br: any) => [br.exchange, br.percent]) || [],
      type: "gauge",
    }),
    [bestRoute]
  );

  const {
    error,
    srcAmount,
    transactionHash,
    user,
    tokenFrom,
    tokenTo,
    priceRoute,
    loading,
    payTo,
  } = state;

  return (
    <div className={"app"}>
      <Image src={LOGO} />

      {error && (
        <Message negative icon>
          <Icon name="exclamation" />
          <Message.Content>
            <Message.Content>{error}</Message.Content>
          </Message.Content>
        </Message>
      )}

      {user && user.address && (
        <Message info>
          <Message.Header>Connected</Message.Header>
          <Message.Content>{user.address}</Message.Content>
        </Message>
      )}

      {transactionHash && (
        <Message info>
          <a
            target={"_blank"}
            href={`https://etherscan.io/tx/${transactionHash}`}
          >
            Track transaction
          </a>
        </Message>
      )}

      <Form>
        <Form.Field>
          <Input
            autoFocus={true}
            onChange={(e: any) => setSrcAmount(e.target.value)}
            value={srcAmount}
            placeholder="Amount"
          />
        </Form.Field>

        <Form.Field>
          <Dropdown
            placeholder="From"
            search
            fluid
            selection
            options={options}
            value={tokenFrom && tokenFrom.symbol}
            onChange={(_: any, data: any) => updatePair("from", data.value)}
          />
        </Form.Field>

        <Form.Field>
          <Dropdown
            placeholder="To"
            search
            fluid
            selection
            options={options}
            value={tokenTo && tokenTo.symbol}
            onChange={(_: any, data: any) => updatePair("to", data.value)}
          />
        </Form.Field>

        <Form.Field>
          <Input value={destAmount} placeholder="Amount" />
        </Form.Field>

        <Form.Field>
          {priceRoute ? (
            <C3Chart className={"distribution-chart"} data={c3Data} />
          ) : null}
        </Form.Field>

        <Form.Field>
          {priceRoute ? (
            <Segment.Group horizontal>
              {bestRoute.map((pr: any) => (
                <Segment key={pr.exchange}>
                  {pr.exchange} {pr.percent}%
                </Segment>
              ))}
            </Segment.Group>
          ) : null}
        </Form.Field>

        <Form.Field>
          <Input
            className={"pay-to"}
            onChange={onPayToChanged}
            value={payTo}
            placeholder="Pay To"
          />
        </Form.Field>

        <Form.Field>
          <Button
            loading={loading}
            onClick={() => getBestPrice(srcAmount)}
            primary
            fluid
          >
            GET RATES
          </Button>
        </Form.Field>

        <Form.Field>
          {tokenFrom && priceRoute && needsAllowance() ? (
            <Button
              positive
              disabled={loading || !priceRoute}
              onClick={setAllowance}
              primary
              fluid
            >
              APPROVE TOKEN
            </Button>
          ) : (
            <Button
              positive
              disabled={loading || !priceRoute}
              onClick={swapOrPay}
              primary
              fluid
            >
              {payTo ? "PAY" : "SWAP"}
            </Button>
          )}
        </Form.Field>
      </Form>
    </div>
  );
};

export default Swapper;

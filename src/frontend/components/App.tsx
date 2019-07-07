/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import * as React from "react";
import {Id64String, Id64Set, OpenMode} from "@bentley/bentleyjs-core";
import {AccessToken, ConnectClient, IModelQuery, Project, Config} from "@bentley/imodeljs-clients";
import { IModelApp, IModelConnection, FrontendRequestContext, AuthorizedFrontendRequestContext, Viewport, ViewState3d } from "@bentley/imodeljs-frontend";
import {Presentation, SelectionChangeEventArgs, ISelectionProvider} from "@bentley/presentation-frontend";

import {Button, ButtonSize, ButtonType, Spinner, SpinnerSize} from "@bentley/ui-core";
import {SignIn} from "@bentley/ui-components";
import {SimpleViewerApp} from "../api/SimpleViewerApp";
import PropertiesWidget from "./Properties";
import GridWidget from "./Table";
import TreeWidget from "./Tree";
import ViewportContentControl from "./Viewport";
import "@bentley/icons-generic-webfont/dist/bentley-icons-generic-webfont.css";
import "./App.css";
import {ElementProps, RenderMode, BackgroundMapType} from "@bentley/imodeljs-common";
import {SampleFeatureOverrideProvider} from "./SampleFeatureOverrideProvider";
import {createSliderWithTooltip, Range} from "rc-slider";
import "rc-slider/assets/index.css";
import {CylinderDecorator} from "./CylinderDecorator";
import {Data} from "./Data";

// tslint:disable: no-console
// cSpell:ignore imodels

// const createSliderWithTooltip = Slider.createSliderWithTooltip;
// tslint:disable-next-line:variable-name
const RangeOfTwo = createSliderWithTooltip(Range);

/** React state of the App component */
export interface AppState {
    user: {
        accessToken?: AccessToken;
        isLoading?: boolean;
    };
    offlineIModel: boolean;
    imodel?: IModelConnection;
    viewDefinitionId?: Id64String;
    fullScreen: boolean;
}

/** A component the renders the whole application UI */
export default class App extends React.Component<{}, AppState> {

    /** Creates an App instance */
    constructor(props?: any, context?: any) {
        super(props, context);
        this.state = {
            user: {
                isLoading: false,
                accessToken: undefined,
            },
            offlineIModel: false,
            fullScreen: false,
        };
        this._keyPress = this._keyPress.bind(this);
    }

    public componentDidMount() {
        // subscribe for unified selection changes
        Presentation.selection.selectionChange.addListener(this._onSelectionChanged);

        // Initialize authorization state, and add listener to changes
        SimpleViewerApp.oidcClient.onUserStateChanged.addListener(this._onUserStateChanged);
        if (SimpleViewerApp.oidcClient.isAuthorized) {
            SimpleViewerApp.oidcClient.getAccessToken(new FrontendRequestContext()) // tslint:disable-line: no-floating-promises
                .then((accessToken: AccessToken | undefined) => {
                    this.setState((prev) => ({user: {...prev.user, accessToken, isLoading: false}}));
                });
        }

        document.addEventListener("keydown", this._keyPress, false);
    }

    public componentWillUnmount() {
        // unsubscribe from unified selection changes
        Presentation.selection.selectionChange.removeListener(this._onSelectionChanged);
        // unsubscribe from user state changes
        SimpleViewerApp.oidcClient.onUserStateChanged.removeListener(this._onUserStateChanged);

        document.removeEventListener("keydown", this._keyPress, false);
    }

    private _onSelectionChanged = (evt: SelectionChangeEventArgs, selectionProvider: ISelectionProvider) => {
        const selection = selectionProvider.getSelection(evt.imodel, evt.level);
        if (selection.isEmpty) {
            console.log("========== Selection cleared ==========");
        } else {
            console.log("========== Selection change ===========");
            if (selection.instanceKeys.size !== 0) {
                // log all selected ECInstance ids grouped by ECClass name
                console.log("ECInstances:");
                selection.instanceKeys.forEach((ids, ecclass) => {
                    console.log(`${ecclass}: [${[...ids].join(",")}]`);
                });
            }
            if (selection.nodeKeys.size !== 0) {
                // log all selected node keys
                console.log("Nodes:");
                selection.nodeKeys.forEach((key) => console.log(JSON.stringify(key)));
            }
            console.log("=======================================");
        }
    }

    private _onRegister = () => {
        window.open("https://imodeljs.github.io/iModelJs-docs-output/getting-started/#developer-registration", "_blank");
    }

    private _onOffline = () => {
        this.setState((prev) => ({user: {...prev.user, isLoading: false}, offlineIModel: true}));
    }

    private _onStartSignin = async () => {
        this.setState((prev) => ({user: {...prev.user, isLoading: true}}));
        await SimpleViewerApp.oidcClient.signIn(new FrontendRequestContext());
    }

    private _onUserStateChanged = (accessToken: AccessToken | undefined) => {
        this.setState((prev) => ({user: {...prev.user, accessToken, isLoading: false}}));
    }

    /** Pick the first available spatial view definition in the imodel */
    private async getFirstViewDefinitionId(imodel: IModelConnection): Promise<Id64String> {
        const viewSpecs = await imodel.views.queryProps({});
        const acceptedViewClasses = [
            "BisCore:SpatialViewDefinition",
            "BisCore:DrawingViewDefinition",
        ];
        const acceptedViewSpecs = viewSpecs.filter((spec) => (-1 !== acceptedViewClasses.indexOf(spec.classFullName)));
        if (0 === acceptedViewSpecs.length)
            throw new Error("No valid view definitions in imodel");

        // Prefer spatial view over drawing.
        const spatialViews = acceptedViewSpecs.filter((v) => {
            return v.classFullName === "BisCore:SpatialViewDefinition";
        });

        if (spatialViews.length > 0)
            return spatialViews[0].id!;

        return acceptedViewSpecs[0].id!;
    }

    /** Handle iModel open event */
    private _onIModelSelected = async (imodel: IModelConnection | undefined) => {
        if (!imodel) {
            // reset the state when imodel is closed
            this.setState({imodel: undefined, viewDefinitionId: undefined});
            return;
        }
        try {
            // attempt to get a view definition
            const viewDefinitionId = imodel ? await this.getFirstViewDefinitionId(imodel) : undefined;
            this.setState({imodel, viewDefinitionId});
        } catch (e) {
            // if failed, close the imodel and reset the state
            if (this.state.offlineIModel) {
                await imodel.closeSnapshot();
            } else {
                await imodel.close();
            }
            this.setState({imodel: undefined, viewDefinitionId: undefined});
            console.log(e);
            alert(e.message);
        }
    }

    private get _signInRedirectUri() {
        const split = (Config.App.get("imjs_browser_test_redirect_uri") as string).split("://");
        return split[split.length - 1];
    }

    private _keyPress(event: any) {
        switch (event.keyCode) {
            case 70: // "F"
                // Toggles the viewport taking over entire screen
                this.setState((s) => ({fullScreen: !s.fullScreen}));
                break;
        }
    }

    /** The component's render method */
    public render() {
        let ui: React.ReactNode;

        if (this.state.user.isLoading || window.location.href.includes(this._signInRedirectUri)) {
            // if user is currently being loaded, just tell that
            ui = `${IModelApp.i18n.translate("SimpleViewer:signing-in")}...`;
        } else if (!this.state.user.accessToken && !this.state.offlineIModel) {
            // if user doesn't have and access token, show sign in page
            ui = (<SignIn onSignIn={this._onStartSignin} onRegister={this._onRegister} onOffline={this._onOffline}/>);
        } else if (!this.state.imodel || !this.state.viewDefinitionId) {
            // if we don't have an imodel / view definition id - render a button that initiates imodel open
            ui = (<OpenIModelButton accessToken={this.state.user.accessToken} offlineIModel={this.state.offlineIModel}
                                    onIModelSelected={this._onIModelSelected}/>);
        } else {
            // if we do have an imodel and view definition id - render imodel components
            ui = (<IModelComponents imodel={this.state.imodel} viewDefinitionId={this.state.viewDefinitionId}/>);
        }

        // To hide everything when the viewport id full screen
        const appClassName = this.state.fullScreen ? "app app-full-screen" : "app";

        // render the app
        return (
            <div className={appClassName}>
                <div className="app-header">
                    <h2>{IModelApp.i18n.translate("SimpleViewer:welcome-message")}</h2>
                </div>
                {ui}
            </div>
        );
    }
}

/** React props for [[OpenIModelButton]] component */
interface OpenIModelButtonProps {
    accessToken: AccessToken | undefined;
    offlineIModel: boolean;
    onIModelSelected: (imodel: IModelConnection | undefined) => void;
}

/** React state for [[OpenIModelButton]] component */
interface OpenIModelButtonState {
    isLoading: boolean;
}

/** Renders a button that opens an iModel identified in configuration */
class OpenIModelButton extends React.PureComponent<OpenIModelButtonProps, OpenIModelButtonState> {
    public state = {isLoading: false};

    /** Finds project and imodel ids using their names */
    private async getIModelInfo(): Promise<{ projectId: string, imodelId: string }> {
        const projectName = Config.App.get("imjs_test_project");
        const imodelName = Config.App.get("imjs_test_imodel");

        const requestContext: AuthorizedFrontendRequestContext = await AuthorizedFrontendRequestContext.create();

        const connectClient = new ConnectClient();
        let project: Project;
        try {
            project = await connectClient.getProject(requestContext, {$filter: `Name+eq+'${projectName}'`});
        } catch (e) {
            throw new Error(`Project with name "${projectName}" does not exist`);
        }

        const imodelQuery = new IModelQuery();
        imodelQuery.byName(imodelName);
        const imodels = await IModelApp.iModelClient.iModels.get(requestContext, project.wsgId, imodelQuery);
        if (imodels.length === 0)
            throw new Error(`iModel with name "${imodelName}" does not exist in project "${projectName}"`);
        return {projectId: project.wsgId, imodelId: imodels[0].wsgId};
    }

    /** Handle iModel open event */
    private async onIModelSelected(imodel: IModelConnection | undefined) {
        this.props.onIModelSelected(imodel);
        this.setState({isLoading: false});
    }

    private _onClick = async () => {
        this.setState({isLoading: true});
        let imodel: IModelConnection | undefined;
        try {
            // attempt to open the imodel
            if (this.props.offlineIModel) {
                const offlineIModel = Config.App.getString("imjs_offline_imodel");
                imodel = await IModelConnection.openSnapshot(offlineIModel);
            } else {
                const info = await this.getIModelInfo();
                imodel = await IModelConnection.open(info.projectId, info.imodelId, OpenMode.Readonly);
            }
        } catch (e) {
            console.log(e);
            alert(e.message);
        }
        await this.onIModelSelected(imodel);
    }

    public render() {
        return (
          <div className="button-open-imodel-wrapper">
            <Button size={ButtonSize.Large} buttonType={ButtonType.Primary} className="button-open-imodel"
                    onClick={this._onClick}>
                <span>{IModelApp.i18n.translate("SimpleViewer:components.imodel-picker.open-imodel")}</span>
                {this.state.isLoading ?
                    <span style={{marginLeft: "8px"}}><Spinner size={SpinnerSize.Small}/></span> : undefined}
            </Button>
            <p>Keyboard shortcuts:</p>
              <ul>
                  <li><b>Space </b> Toggle showing the water pipes as "grey" or "invisible"</li>
                  <li><b>R </b> Toggle showing the pipes we have no information about as "red" or "invisible"</li>
                  <li><b>F </b> Toggle the viewport taking over entire screen</li>
                  <li><b>M </b> Toggle map backdrop</li>
              </ul>
          </div>
        );
    }
}

/** React props for [[IModelComponents]] component */
interface IModelComponentsProps {
    imodel: IModelConnection;
    viewDefinitionId: Id64String;
}

interface IModelComponentsState {
    depthSlice: number[];
    vp: Viewport | undefined;
    elements: ElementProps[] | undefined;
    selectedElement: string | undefined;
    showWater: boolean;
    showRed: boolean;
}

/** Renders a viewport, a tree, a property grid and a table */
class IModelComponents extends React.PureComponent<IModelComponentsProps, IModelComponentsState> {
    private _activeDecorators: CylinderDecorator[];

    constructor(props: IModelComponentsProps, context: any) {
        super(props, context);
        this.state = {depthSlice: [0, 1000], vp: undefined, elements: undefined, selectedElement: undefined, showWater: false, showRed: false};
        this.props.imodel.selectionSet.onChanged.addListener(this._selectionChange.bind(this));
        this._activeDecorators = [];
        this.keyPress = this.keyPress.bind(this);
    }

    public componentDidMount() {
        IModelApp.viewManager.onViewOpen.addOnce(async (vp: Viewport) => {
            // once view renders, set to solid fill
            this._setSolidRender(vp);
            this.setState(() => ({vp}));
            this._setBackgroundMap(vp, BackgroundMapType.Hybrid);
        });
        this._loadElements(this.props.imodel).then((elements: ElementProps[]) => {
            this.setState(() => ({elements}));

            /*TODO invent depth from CSV
            elements.forEach(element => {
                if (!(element.upDepth && element.downDepth)) {
                    element.recalculatedDepth = Data.data
                        .filter(datum => datum.ID === element.ID)
                        .map(datum => datum.depth)
                        .reduce()
                }
            });*/
        });
        document.addEventListener("keydown", this.keyPress, false);
    }

    public componentWillUnmount() {
      document.removeEventListener("keydown", this.keyPress, false);
    }

    private _setBackgroundMap = (vp: Viewport, mapType: BackgroundMapType) => {
      vp.viewFlags.backgroundMap = true;
      const mapProps = {
        providerName: "BingProvider",
        providerData: {
          mapType,
        },
      };
      (vp.view as ViewState3d).getDisplayStyle3d().setBackgroundMap(mapProps);
      vp.synchWithView(true);
    }

    private _loadElements = async (imodel: IModelConnection) => {
        // load all physical elements in the iModel
        return imodel.elements.queryProps({
            from: "Bis.PhysicalElement",
        });
    }

    private _setSolidRender = (vp: Viewport) => {
        vp.viewFlags.renderMode = RenderMode.SolidFill;
        vp.sync.invalidateController();
        vp.target.reset();
        vp.synchWithView(false);
    }

    private _sliderChange = (slice: number[]) => {
        this.setState(() => ({depthSlice: slice}));
    }

    private keyPress(event: any) {
      switch (event.keyCode) {

        case 32: // "Spacebar"
          // Toggles showing the water pipes as "grey" or "invisible"
          this.setState((s) => ({showWater: !s.showWater}));
          break;

        case 82: // "R"
          // Toggles showing the pipes we have no information about as "red" or "invisible"
          this.setState((s) => ({showRed: !s.showRed}));
          break;

        case 77: // "M"
          // Toggle background map
          if (this.state.vp) {
              this.state.vp.viewFlags.backgroundMap = !this.state.vp.viewFlags.backgroundMap;
              // Update the viewport with the change
              this.state.vp.synchWithView(false);
          }
          break;
      }
    }

    private _selectionChange(_imodel: IModelConnection, _eventType: any, elements?: Id64Set) {
        console.log("_selectionChange ", elements);

        // Used as a one-off to retrieve big array of IDs
        // if (elements) this.manyQuery(_imodel, elements);

        const nextElement = elements && elements.entries().next();
        if (nextElement) {
            _imodel.elements.getProps(nextElement.value[0]).then((ep: ElementProps[]) => {
                console.log("Retrieve ElementProps ", ep);
                this.setState(() => ({selectedElement: ep[0].bentley_ID_}));
            });
        } else {
            this.setState(() => ({selectedElement: undefined}));
        }
    }

    // Used as a one-off to retrieve big array of IDs
    /*private async manyQuery(_imodel: IModelConnection, elements: Set<string>) {
        let u: string[] = [];
        elements.forEach(nextElement => _imodel.elements.getProps(nextElement).then((ep: ElementProps[]) => {
            u.push(ep[0].bentley_ID_);
        }));

        setTimeout(() =>
                console.log(u),
            5000);

    }*/

    public render() {
        // ID of the presentation ruleset used by all of the controls; the ruleset
        // can be found at `assets/presentation_rules/Default.PresentationRuleSet.xml`
        const rulesetId = "Default";

        if (this.state.vp && this.state.elements) {
            // set feature overrides to alter appearance of elements
            this.state.vp.featureOverrideProvider = new SampleFeatureOverrideProvider(this.state.elements, this.state.depthSlice, this.state.showWater, this.state.showRed);

            // Drop active decorators if exist
            this._activeDecorators.forEach((decorator) => IModelApp.viewManager.dropDecorator(decorator));
            // Create new decorators if something is selected
            if (this.state.selectedElement) {

                console.log("this.state.selectedElement ", this.state.selectedElement);

                const filteredData = Data.data
                    .filter((datum) => datum.ID === this.state.selectedElement);
                const min: number = Math.min(...filteredData.map((datum) => datum.depth));
                const max: number = Math.max(...filteredData.map((datum) => datum.depth));

                this._activeDecorators = filteredData
                    .map((datum) => new CylinderDecorator(datum.X, datum.Y, datum.depth, min, max));
                this._activeDecorators.forEach((dec) => IModelApp.viewManager.addDecorator(dec));

            } else {
                this._activeDecorators = [];
            }
        }

        return (
            <div className="app-content">
                <div className="top-right">
                    <TreeWidget imodel={this.props.imodel} rulesetId={rulesetId}/>
                </div>
                <div className="bottom-right">
                    <PropertiesWidget imodel={this.props.imodel} rulesetId={rulesetId}/>
                </div>
                <div className="bottom-left">
                    <GridWidget imodel={this.props.imodel} rulesetId={rulesetId}/>
                </div>
                <div className="middle-left">
                    <p>Depth slice:</p>
                    <RangeOfTwo min={0}
                                max={8000}
                                defaultValue={[0, 2000]}
                                onChange={this._sliderChange}
                    />
                </div>
                <div className="top-left"
                     style={{visibility: this.state.vp && this.state.elements ? "inherit" : "hidden"}}>
                    <ViewportContentControl imodel={this.props.imodel} rulesetId={rulesetId}
                                            viewDefinitionId={this.props.viewDefinitionId}/>
                </div>
            </div>
        );
    }
}

/** @jsxImportSource preact */
import { render } from "preact";
import "../local-fonts.css";
import { Widget } from "./Widget";
import "./widget.css";

render(<Widget />, document.getElementById("widget-root")!);

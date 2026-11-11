<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:my="http://schemas.microsoft.com/office/infopath/2003/myXSD/2026-01-12T10:00:00" xmlns:xd="http://schemas.microsoft.com/office/infopath/2003" xmlns:xdXDocument="http://schemas.microsoft.com/office/infopath/2003/xslt/xDocument" xmlns:xdFormatting="http://schemas.microsoft.com/office/infopath/2003/xslt/formatting" xmlns:msxsl="urn:schemas-microsoft-com:xslt">
	<xsl:output method="html" indent="no"/>
	<xsl:template match="my:expenseReport">
		<html>
			<head><meta content="text/html" http-equiv="Content-Type"></meta><style controlStyle="controlStyle">BODY{margin-left:21px;}</style></head>
			<body style="BACKGROUND-COLOR: #ffffff">
				<div>
					<table class="xdLayout" style="WIDTH: 700px; TABLE-LAYOUT: fixed" border="1">
						<colgroup><col style="WIDTH: 350px"></col><col style="WIDTH: 350px"></col></colgroup>
						<tbody vAlign="top">
							<tr>
								<td colSpan="2"><div><font size="4"><strong>Expense Report</strong></font></div></td>
							</tr>
							<tr>
								<td><div><font>Employee name:</font></div>
									<div><span class="xdTextBox" hideFocus="1" title="Your full name" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL1" xd:binding="my:employeeName" style="WIDTH: 100%"><xsl:value-of select="my:employeeName"/></span></div>
								</td>
								<td><div><font>Email:</font></div>
									<div><span class="xdTextBox" hideFocus="1" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL2" xd:binding="my:email" style="WIDTH: 100%"><xsl:value-of select="my:email"/></span></div>
								</td>
							</tr>
							<tr>
								<td><div>Department:</div>
									<div><select class="xdComboBox xdBehavior_Select" title="" size="1" tabIndex="0" xd:xctname="dropdown" xd:CtrlId="CTRL3" xd:binding="my:department" xd:boundProp="value" style="WIDTH: 100%">
										<xsl:attribute name="value"><xsl:value-of select="my:department"/></xsl:attribute>
										<option><xsl:if test="my:department=&quot;&quot;"><xsl:attribute name="selected">selected</xsl:attribute></xsl:if>Select...</option>
										<option value="Operations"><xsl:if test="my:department=&quot;Operations&quot;"><xsl:attribute name="selected">selected</xsl:attribute></xsl:if>Operations</option>
										<option value="Sales"><xsl:if test="my:department=&quot;Sales&quot;"><xsl:attribute name="selected">selected</xsl:attribute></xsl:if>Sales</option>
										<option value="Engineering"><xsl:if test="my:department=&quot;Engineering&quot;"><xsl:attribute name="selected">selected</xsl:attribute></xsl:if>Engineering</option>
									</select></div>
								</td>
								<td><div>Cost center:</div>
									<div><span class="xdTextBox" hideFocus="1" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL4" xd:binding="my:costCenter" style="WIDTH: 100%"><xsl:value-of select="my:costCenter"/></span></div>
								</td>
							</tr>
							<tr>
								<td><div>Project:</div>
									<div><select class="xdComboBox xdBehavior_Select" size="1" tabIndex="0" xd:xctname="dropdown" xd:CtrlId="CTRL5" xd:binding="my:project" xd:boundProp="value" style="WIDTH: 100%">
										<xsl:attribute name="value"><xsl:value-of select="my:project"/></xsl:attribute>
										<xsl:choose>
											<xsl:when test="function-available('xdXDocument:GetDOM')">
												<option/>
												<xsl:variable name="val" select="my:project"/>
												<xsl:if test="not(xdXDocument:GetDOM(&quot;Projects&quot;)/dfs:myFields/dfs:dataFields/d:SharePointListItem_RW/d:Code[.=$val] or $val='')"><option selected="selected"><xsl:attribute name="value"><xsl:value-of select="$val"/></xsl:attribute><xsl:value-of select="$val"/></option></xsl:if>
												<xsl:for-each select="xdXDocument:GetDOM(&quot;Projects&quot;)/dfs:myFields/dfs:dataFields/d:SharePointListItem_RW">
													<option><xsl:attribute name="value"><xsl:value-of select="d:Code"/></xsl:attribute><xsl:value-of select="d:Title"/></option>
												</xsl:for-each>
											</xsl:when>
										</xsl:choose>
									</select></div>
								</td>
								<td><div>Report date:</div>
									<div class="xdDTPicker" title="" style="WIDTH: 100%" noWrap="1" xd:xctname="DTPicker" xd:CtrlId="CTRL6"><span class="xdDTText xdBehavior_FormattingNoBUI" hideFocus="1" contentEditable="true" tabIndex="0" xd:xctname="DTPicker_DTText" xd:binding="my:reportDate" xd:innerCtrl="_DTText" xd:datafmt="&quot;date&quot;,&quot;dateFormat:Short Date;&quot;" xd:boundProp="xd:num"><xsl:value-of select="my:reportDate"/></span><button class="xdDTButton" xd:xctname="DTPicker_DTButton" xd:innerCtrl="_DTButton" tabIndex="-1"><img src="res://infopath.exe/calendar.gif"/></button></div>
								</td>
							</tr>
							<tr>
								<td colSpan="2"><div>Business purpose:</div>
									<div><span class="xdRichTextBox" hideFocus="1" tabIndex="0" xd:xctname="RichText" xd:CtrlId="CTRL7" xd:binding="my:purpose" style="WIDTH: 100%; HEIGHT: 50px"><xsl:copy-of select="my:purpose/node()"/></span></div>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<div><font size="3"><strong>Line items</strong></font></div>
				<div>
					<table class="xdRepeatingTable msoUcTable" title="" style="TABLE-LAYOUT: fixed; WIDTH: 700px" border="1" xd:CtrlId="CTRL8">
						<colgroup><col style="WIDTH: 110px"></col><col style="WIDTH: 200px"></col><col style="WIDTH: 120px"></col><col style="WIDTH: 70px"></col><col style="WIDTH: 100px"></col><col style="WIDTH: 100px"></col></colgroup>
						<tbody class="xdTableHeader">
							<tr>
								<td><div><strong>Date</strong></div></td>
								<td><div><strong>Description</strong></div></td>
								<td><div><strong>Category</strong></div></td>
								<td><div><strong>Qty</strong></div></td>
								<td><div><strong>Unit price</strong></div></td>
								<td><div><strong>Line total</strong></div></td>
							</tr>
						</tbody>
						<tbody xd:xctname="RepeatingTable">
							<xsl:for-each select="my:items/my:item">
								<tr>
									<td><div class="xdDTPicker" style="WIDTH: 100%" noWrap="1" xd:xctname="DTPicker" xd:CtrlId="CTRL9"><span class="xdDTText xdBehavior_FormattingNoBUI" hideFocus="1" contentEditable="true" tabIndex="0" xd:xctname="DTPicker_DTText" xd:binding="my:expenseDate" xd:innerCtrl="_DTText" xd:datafmt="&quot;date&quot;,&quot;dateFormat:Short Date;&quot;" xd:boundProp="xd:num"><xsl:value-of select="my:expenseDate"/></span><button class="xdDTButton" xd:xctname="DTPicker_DTButton" xd:innerCtrl="_DTButton" tabIndex="-1"><img src="res://infopath.exe/calendar.gif"/></button></div></td>
									<td><span class="xdTextBox" hideFocus="1" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL10" xd:binding="my:description" style="WIDTH: 100%"><xsl:value-of select="my:description"/></span></td>
									<td><select class="xdComboBox xdBehavior_Select" size="1" tabIndex="0" xd:xctname="dropdown" xd:CtrlId="CTRL11" xd:binding="my:category" xd:boundProp="value" style="WIDTH: 100%">
										<xsl:attribute name="value"><xsl:value-of select="my:category"/></xsl:attribute>
										<option value="Travel"><xsl:if test="my:category=&quot;Travel&quot;"><xsl:attribute name="selected">selected</xsl:attribute></xsl:if>Travel</option>
										<option value="Meals"><xsl:if test="my:category=&quot;Meals&quot;"><xsl:attribute name="selected">selected</xsl:attribute></xsl:if>Meals</option>
										<option value="Lodging"><xsl:if test="my:category=&quot;Lodging&quot;"><xsl:attribute name="selected">selected</xsl:attribute></xsl:if>Lodging</option>
										<option value="Other"><xsl:if test="my:category=&quot;Other&quot;"><xsl:attribute name="selected">selected</xsl:attribute></xsl:if>Other</option>
									</select></td>
									<td><span class="xdTextBox xdBehavior_Formatting" hideFocus="1" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL12" xd:binding="my:quantity" xd:datafmt="&quot;number&quot;,&quot;numDigits:0;negativeOrder:1;&quot;" xd:boundProp="xd:num" style="WIDTH: 100%; TEXT-ALIGN: right"><xsl:value-of select="my:quantity"/></span></td>
									<td><span class="xdTextBox xdBehavior_Formatting" hideFocus="1" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL13" xd:binding="my:unitPrice" xd:datafmt="&quot;currency&quot;,&quot;numDigits:2;negativeOrder:0;currencyLocale:1033;&quot;" xd:boundProp="xd:num" style="WIDTH: 100%; TEXT-ALIGN: right"><xsl:value-of select="my:unitPrice"/></span></td>
									<td><span class="xdTextBox xdBehavior_Formatting" hideFocus="1" tabIndex="-1" xd:xctname="PlainText" xd:CtrlId="CTRL14" xd:binding="my:lineTotal" xd:disableEditing="yes" xd:datafmt="&quot;currency&quot;,&quot;numDigits:2;negativeOrder:0;currencyLocale:1033;&quot;" xd:boundProp="xd:num" style="WIDTH: 100%; TEXT-ALIGN: right"><xsl:value-of select="my:lineTotal"/></span></td>
								</tr>
							</xsl:for-each>
						</tbody>
						<tbody class="xdTableFooter">
							<tr>
								<td colSpan="5"><div align="right"><strong>Total</strong></div></td>
								<td><span class="xdTextBox xdBehavior_Formatting" hideFocus="1" tabIndex="-1" xd:xctname="PlainText" xd:CtrlId="CTRL15" xd:binding="my:total" xd:disableEditing="yes" xd:datafmt="&quot;currency&quot;,&quot;numDigits:2;negativeOrder:0;currencyLocale:1033;&quot;" xd:boundProp="xd:num" style="WIDTH: 100%; TEXT-ALIGN: right"><xsl:value-of select="my:total"/></span></td>
							</tr>
						</tbody>
					</table>
					<div class="optionalPlaceholder" xd:xmlToEdit="item_2" tabIndex="0" xd:action="xCollection::insert" style="WIDTH: 700px">Insert item</div>
				</div>
				<div>
					<table class="xdLayout" style="WIDTH: 700px; TABLE-LAYOUT: fixed" border="1">
						<colgroup><col style="WIDTH: 350px"></col><col style="WIDTH: 350px"></col></colgroup>
						<tbody vAlign="top">
							<tr>
								<td><div>Manager email:</div>
									<div><span class="xdTextBox" hideFocus="1" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL16" xd:binding="my:managerEmail" style="WIDTH: 100%"><xsl:attribute name="style">WIDTH: 100%;<xsl:choose><xsl:when test="my:total &lt;= 1000">DISPLAY: none;caption: Hide for small reports</xsl:when></xsl:choose></xsl:attribute><xsl:value-of select="my:managerEmail"/></span></div>
								</td>
								<td><div>Receipts:</div>
									<div><span class="xdFileAttachment" hideFocus="1" tabIndex="0" xd:xctname="FileAttachment" xd:CtrlId="CTRL17" xd:binding="my:receipts" style="WIDTH: 100%"></span></div>
								</td>
							</tr>
							<tr>
								<td><div>Status:</div>
									<div><span class="xdTextBox" hideFocus="1" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL18" xd:binding="my:status" style="WIDTH: 100%"><xsl:attribute name="xd:disableEditing"><xsl:choose><xsl:when test="my:status != &quot;Draft&quot;">yes</xsl:when></xsl:choose></xsl:attribute><xsl:attribute name="style">WIDTH: 100%;<xsl:choose><xsl:when test="my:status = &quot;Submitted&quot;">COLOR: #008000;caption: Green when submitted</xsl:when></xsl:choose></xsl:attribute><xsl:value-of select="my:status"/></span></div>
								</td>
								<td><div><input class="langFont" title="" type="button" value="Submit report" xd:xctname="Button" xd:CtrlId="CTRL20" tabIndex="0"/>
									<input class="langFont" title="" type="button" value="Refresh projects" xd:xctname="Button" xd:CtrlId="CTRL21" tabIndex="0"/></div>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</body>
		</html>
	</xsl:template>
</xsl:stylesheet>
